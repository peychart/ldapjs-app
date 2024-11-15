const express = require('express');
const ldap = require('ldapjs');
const path = require('path');
//const configPath = path.join(__dirname, 'config.json');
const bodyParser = require('body-parser');
const cookieParser = require('cookie-parser');
const session = require('express-session');
const passport = require('passport');
const { Strategy: LdapStrategy } = require('passport-ldapauth');
const winston = require('winston');
const {
	bindClient,
	searchLDAP,
	rawSearchLDAP,
	loadSchema,
	getUserRoleFromDatabase,
	setInheritedMustAttributes,
	enrichObjectClassWithAttributes,
	getObjectClassByName,
	getObjectClassesByType,
	updateLDAP,
	updateAttributeConfigInLDAP
} = require('./utils/ldapUtils');
const {
	loadConfig
} = require('./utils/ldapConfig');
const {
	isEqual
} = require('./utils/utils');
const createLogger = require('./utils/log');

const app = express();
let config;

// Chargement initial de la configuration
(async () => {
	// Chargement initial de la configuration
	const logger = createLogger();
	config = loadConfig();

	try {
		const ldapSchema = await loadSchema(ldap, config);

		// Configuration des middlewares
		app.use(bodyParser.json()); // Pour traiter les JSON
		app.use(bodyParser.urlencoded({ extended: true })); // Pour parser les données de formulaire
		app.use(cookieParser());

		app.use(session({
			secret: config.sessionSecret,
			resave: false,
			saveUninitialized: true,
			cookie: { maxAge: 4 * 60 * 60 * 1000 } // Durée de vie du cookie de session
		}));

		// Initialisation de Passport
		app.use(passport.initialize());
		app.use(passport.session());

		app.use('/js', express.static(path.join(__dirname, 'public/js')));
		app.set('view engine', 'ejs');

		// Middleware de journalisation des actions
		app.use((req, res, next) => {
			const user = req.session.user ? req.session.user : { dn: 'Anonyme', role: 'Invité' }; // Valeurs par défaut pour les utilisateurs non authentifiés
			const logMessage = {
				userDn: user.dn, // Distinguished Name de l'utilisateur
				userRole: user.role, // Rôle de l'utilisateur
				path: req.path, // Chemin de la requête
				method: req.method, // Méthode de la requête
				time: new Date().toISOString() // Heure de la requête
			};

			// Journaliser le message
			logger.info(logMessage);
			next();
		});

		// Fin de la configuration initiale
		logger.info('Application démarrée avec succès.');

		// Définir vos routes ici, par exemple :


		// ****************************************************************************
		// *********************** DEFINITION DES ROUTES ******************************

		// ***********************************************************
		// Route pour le masque de connexion
		app.get('/', (req, res) => {
			// Lire les cookies pour obtenir les données précédentes
			const login = req.cookies.login || ''; // Lire le DN du cookie, s'il existe

			// Rendre la vue de connexion avec le login précédent
			res.render('login', { login, error: null, ldapUrl: `${config.ldap.url}:${config.ldap.port}` });
		});


		// ***********************************************************
		// Route pour traiter la soumission du formulaire de connexion
		app.post('/login', async (req, res) => {
			const { login, password } = req.body; // Récupération du login et du mot de passe
			const appClient = ldap.createClient({ url: `${config.ldap.url}:${config.ldap.port}` });
			let client;

			try {
				// Créer un client LDAP
				await bindClient(appClient, config.ldap.data.bindDN, config.ldap.data.bindPassword);

				// Définir les attributs à rechercher
				const attributesToSearch = ['uid', 'mail', 'employeeNumber', 'sn', 'givenName', 'cn'];

				const searchPromises = attributesToSearch.map(attr => {
					const searchOptions = {
						filter: `(${attr}=${login})`, // Filtrer par chaque attribut
						scope: 'sub',
						attributes: ['dn'], // N'inclure que le DN dans le résultat
						sizeLimit: 15
					};

					return rawSearchLDAP(appClient, config.ldap.data.baseDN, searchOptions).catch(err => {
						return []; // Retourner un tableau vide en cas d'erreur
					});;
				});

				// Attendre que toutes les recherches soient terminées
				const searchResults = await Promise.all(searchPromises);

				// Filtrer les résultats pour obtenir le DN : extraire objectName pour le dn ...
				const validResults = searchResults.flat().map(result => result.objectName).filter(dn => dn);

				// Vérifier si une entrée a été trouvée
				if (validResults.length === 0) {
					throw new Error('Nom d\'utilisateur ou mot de passe incorrect.'); // Gérer l'erreur ici
				} else if (validResults.length > 1) {
					const allEqual = validResults.every(dn => dn === validResults[0]);
					if (!allEqual) {
						throw new Error('Plus d\'une occurrence d\'identifiant trouvée ! Veuillez préciser davantage votre login.'); // Gérer l'erreur ici
					}
				}

				// Extraire le DN de l'utilisateur à partir du résultat de la recherche
				const bindDN = validResults[0]; // Récupérer le DN de la première entrée

				// Tenter de se connecter au serveur LDAP avec le DN récupéré
				client = ldap.createClient({ url: `${config.ldap.url}:${config.ldap.port}` });
				await bindClient(client, bindDN, password);

				// Authentification réussie, récupérer le rôle de l'utilisateur
				const role = await getUserRoleFromDatabase(bindDN); // Utiliser le DN récupéré

				// Stocker les informations de l'utilisateur dans la session
				req.session.user = {
					dn: bindDN,
					role
				};

				// Authentification de l'application réussie
				req.session.appClient = appClient;

				// Mémoriser le dernier login dans un cookie
				res.cookie('login', login, { maxAge: 24 * 60 * 60 * 1000 }); // Expire dans 1 jour

				// Rediriger vers la page d'accueil
				return res.redirect('/search');

			} catch(err) {
				// Gestion des erreurs : ne pas afficher d'erreur dans la console
				return res.render('login', {
					login: login, // Garder la valeur du login pré-rempli
					error: err.message || 'Nom d\'utilisateur ou mot de passe incorrect.',
				ldapUrl: `${config.ldap.url}:${config.ldap.port}`
				});
			} finally {
				// S'assurer que le client LDAP est déconnecté
			if (client)
				client.unbind();
				appClient.unbind();
			}
		});

		// ***********************************************************
		// Route de déconnexion
		app.get('/logout', (req, res) => {
			// Libérer le client de l'application
			if (req.session.appClient) {
				req.session.appClient.unbind((err) => {
					if (err) {
						console.error('Erreur lors de la déconnexion du client LDAP de l\'application:', err);
					}
				});
			}

			req.session.destroy((err) => {
				if (err) {
					console.error('Erreur lors de la destruction de la session:', err);
				}
				return res.redirect('/'); // Rediriger vers la page de connexion
			});
		});

		// ***********************************************************
		// Routes de recherche
		// Route de recherche (GET)
		app.get('/search', async (req, res) => {
			// Rendre la vue de recherche
			res.render('search', { results: null, searchTerm: req.body.searchTerm, error: null });
		});

		// Route de recherche (POST)
		app.post('/search', async (req, res) => {
			const searchTerm = req.body.searchTerm;

			// Créer un client LDAP
			const client = ldap.createClient({ url: `${config.ldap.url}:${config.ldap.port}` });

			const opts = {
				filter: `(&(objectClass=person)(|(uid=${searchTerm})(cn=${searchTerm})(sn=${searchTerm})(givenName=${searchTerm})(employeeNumber=${searchTerm})))`,
				scope: 'sub',
				attributes: ['dn', 'uid', 'cn', 'sn', 'telephoneNumber', 'o', 'mail', 'employeeNumber']
			};

			try {
				await bindClient(client, config.ldap.data.bindDN, config.ldap.data.bindPassword);

				// Récupérer les résultats de la recherche LDAP
				const results = await searchLDAP(client, config.ldap.data.baseDN, opts);

				// Passer le searchTerm à la vue
				return res.render('search', { results, searchTerm: searchTerm, error: null });

			} catch(error) {
					console.error('Erreur:', error);
				if (client) {
					client.unbind(); // Assurez-vous que le client est délié
				}
				return res.render('search', { results: null, searchTerm: null, error: error.message });
			} finally {
				// Déconnexion du client principal
				if (client) {
					try {
						await client.unbind();
					} catch(unbindError) {
						console.error('Erreur lors de la déconnexion du client:', unbindError);
					}
				}
			}
		});

		// ***********************************************************
		// Route pour éditer un objet
		app.get('/edit/:dn', async (req, res) => {
			const dn = req.params.dn; // Récupérer le DN des paramètres de l'URL
			const client = ldap.createClient({ url: `${config.ldap.url}:${config.ldap.port}` });

			const options = {
				scope: 'base', // Recherche unique sur le DN spécifié
				attributes: ['*'] // Attributs à récupérer
			};

			try {
				// Liaison au client LDAP
				await bindClient(client, config.ldap.data.bindDN, config.ldap.data.bindPassword);

				// Récupration de l'entrée dn à éditer
				const objectData = (await searchLDAP(client, dn, options)
					.catch(() => {
						throw new Error(`Objet ${dn} non trouvé`); // Lancer une erreur vers le catch
					})
				)[0];

				// On élimie l'objectClass === 'top'
				const objectClassesToSearch = objectData.objectClass.filter(element => element !== 'top');

				// Récupérer la définition de chaque objectClass composant notre dn à éditer
				const searchPromises = await Promise.all(objectClassesToSearch.map(async objectClassName => {
					try {
						const cls = getObjectClassByName(ldapSchema, objectClassName);
						const objCls = setInheritedMustAttributes(ldapSchema, cls);
						return enrichObjectClassWithAttributes(ldapSchema, objCls);
					} catch(error) {
						console.error(`Erreur lors de la récupération de ${objectClassName} :`, error);
						return null; // Ou une valeur par défaut, si nécessaire
					}
				}));
				const objectClassesDetails = searchPromises;
//console.clear(); console.log('objectClassesDetails: ', JSON.stringify(objectClassesDetails, null, 2)); // Display for debug

				// Recuperatio des customisations d'attributs
				const attrDefDN = config.configDn.attributs + ',' + config.configDn.root;
				const attrDefOptions = {
					scope: 'one',
					attributes: [ 'cn', 'l', 'description', 'ou' ]
				};
				const attributesConfig = await searchLDAP(client, attrDefDN, attrDefOptions).catch(err => {
					return [];
				});
//console.clear(); console.log('attributesConfig: ', JSON.stringify(attributesConfig, null, 2)); // Display for debug

				// Enrich chaque objectClass du dn courant avec les data d'objectData et d'attributesConfig
				// 1: avec les éventuelles customConf d'attributs définies dans attributesConfig
				objectClassesDetails.forEach(objectClass => {
					// Parcours des attributs de MUST et MAY
					['MUST', 'MAY'].forEach(key => {
						objectClass[key].forEach(currentAttr => {
							const attrCustomizations = attributesConfig.find(item => item.cn.includes(currentAttr.OID)) ?? null;

							// Déterminer si la data d'attribut doit être [] ou SINGLE_VALUE
                    		const customMultiValue = attrCustomizations?.ou ?? null;
                    		const isMultiValue = !currentAttr.SINGLE_VALUE && (customMultiValue?.[0] !== 'SINGLE-VALUE');
							if (!isMultiValue) currentAttr.MULTI_VALUE = 'SINGLE-VALUE';

							if (attrCustomizations) {
								// Ajout des customisations de l'attribut
								if (attrCustomizations?.l || null)
									currentAttr.customWording = attrCustomizations.l;
								if (attrCustomizations?.description || null)
									currentAttr.valueCheck = attrCustomizations?.description;
							}
						});
					});
				});

				// 2: avec les data d'objectData de chaque attribut
				Object.keys(objectData).forEach(attrDataName => { // on parcourt les DATA
					if (attrDataName === 'dn')	return;
					const attrData = objectData[attrDataName]; // Obtenir les data pour chaque attribut

					// Parcourir chaque objectClassDetails à la recherche de l'attribut attrDataName
					objectClassesDetails.forEach(objectClass => { // rechercher dans tous les attributs de l'objectClass à enrichir
						['MUST', 'MAY'].forEach(key => {
							objectClass[key].forEach(currentAttr => {

								if (currentAttr.NAME.find(name => name.toLowerCase() === attrDataName.toLowerCase())) {
									// L'attribut trouvé peut être enrichi
									let VALUES;
									if (currentAttr.MULTI_VALUES !== 'SINGLE-VALUES') {
										VALUES = Array.isArray(attrData)
											? attrData
											: (attrData !== undefined ? [attrData] : null);
									} else {
										VALUES = Array.isArray(attrData)
											? (attrData.length > 0 ? attrData[0] : null)
											: (attrData !== undefined ? attrData : null);
									}

									if (VALUES) {
										// Enrichir le currentAttr de sa DATA
										currentAttr.VALUES = VALUES;
									}
								}
							});
						});
					});
				});
console.clear(); console.log('EnrichObjectClassesDetails: ', JSON.stringify(objectClassesDetails, null, 2)); // Display for debug

				return res.render('edit', {dn, objectClassesDetails: objectClassesDetails, ldapSchema: ldapSchema});

			} catch(error) {
				console.error('Fiche non trouvée:', error);
				return res.status(500).send(error.message); // Renvoyer le message d'erreur
			} finally {
				// Déconnexion du client principal
				if (client) {
					try {
						await client.unbind();
					} catch(unbindError) {
						console.error('Erreur lors de la déconnexion du client:', unbindError);
					}
				}
			}
		});

		app.post('/edit/:dn', async (req, res) => {
			// Déclaration du client de connexion
			const client = ldap.createClient({ url: `${config.ldap.url}:${config.ldap.port}` });
			let dn = req.params.dn; // Assignation de dn depuis les paramètres de l'URL;

			try {
				// Connexion au serveur LDAP
				await bindClient(client, config.ldap.data.bindDN, config.ldap.data.bindPassword);

				// Traitement de la réponse
				const results = Object.keys(req.body).reduce((acc, key) => {
					// Dédoubler les champs input de la réponse (répartis sur les onglets)) :
					const value = Array.isArray(req.body[key]) ? req.body[key][0] : req.body[key];

					// Parse JSON pour les clés marquées de '[]'
					const safeParse = (val) => {
						try {
							return JSON.parse(val);
						} catch(error) {
							return val; // Retourne la valeur d'origine en cas d'erreur
						}
					};

					if (key.endsWith('_hidden') || key === 'businessCategory') {
						const baseKey = key.slice(0, -7); // Enlever '[]' du nom de clé

						// Si la valeur est un tableau, parser chaque élément
						acc[baseKey] = Array.isArray(value) ? value.map(safeParse) : safeParse(value);
					} else {
						// Pour les autres champs, conserver la valeur
						acc[key] = value;
					}

					return acc;
				}, {});

				// Mise à jour de la base LDAP
				await updateLDAP(client, dn, results);

				return res.redirect(`/edit/${dn}`);

			} catch(error) {
				console.error('Erreur:', error);
				res.status(500).send({ error: error.message });
			} finally {
				// Déconnexion du client LDAP
				if (client) {
					client.unbind();
				}
			}
		});

		app.post('/delete/:dn', async (req, res) => {
			// Déclaration du client de connexion
			const client = ldap.createClient({ url: `${config.ldap.url}:${config.ldap.port}` });
			const dn = req.params.dn; // Assignation de dn depuis les paramètres de l'URL;

			try {
				// Connexion au serveur LDAP
				await bindClient(client, config.ldap.data.bindDN, config.ldap.data.bindPassword);

				// Validation du DN avant de supprimer
				if (!dn) {
					return res.status(400).send({ error: 'DN est requis.' });
				}

				// Suppression de l'entrée LDAP
				await new Promise((resolve, reject) => {
					client.del(dn, (err) => {
						if (err) {
							return reject(err);
						}
						resolve();
					});
				});

				// Répondre avec un message de succès
				return res.json({ message: 'Entrée supprimée avec succès.', redirect: '/search' });
			} catch(error) {
				console.error('Erreur:', error);
				return res.status(500).send({ error: 'Erreur lors de la suppression de l\'entrée LDAP : ' + error.message });
			} finally {
				// Déconnexion du client LDAP
				client.unbind();
			}
		});

		// ***********************************************************
		// Route pour valider les contrôle d'attribut édités dans la modale
		app.post('/update-attributeCtl/:dn', async (req, res) => {
			// Déclaration du client de connexion
			const client = ldap.createClient({ url: `${config.ldap.url}:${config.ldap.port}` });

			let dn = req.params.dn; // Assignation de dn depuis les paramètres de l'URL;
			let attrName = null; // Initialisation pour le nom de l'attribut
			let attrConf = {}; // Initialisation d'un objet pour stocker les configurations de l'attribut

			try {
				// Connexion au serveur LDAP
				await bindClient(client, config.ldap.data.bindDN, config.ldap.data.bindPassword);

				// Récupérer les clés du corps de la requête
				const keys = Object.keys(req.body);

				for (let key of keys) {
					if (key === 'attributeId') {
						attrName = req.body[key];
					} else if (key === 'attributeType') {
						if (req.body[key] !== 'SCHEMA')
							attrConf.MULTIVALUE = (req.body[key] === 'MULTI-VALUE');
					} else if (key === 'newLabel' && req.body[key]) {
						attrConf.customWording = req.body[key];
					} else if (key === 'jsValidation' && req.body[key]) {
						attrConf.valueCheck = req.body[key];
					}
				}

				// Validation des données
				if (!attrName) {
					return res.status(400).send('Données manquantes dans \'/update-attributeCtl/:dn\'.');
				}

				// Mise à jour dans la base LDAP
				await updateAttributeConfigInLDAP(client, config, attrName, attrConf);

				return res.redirect(`/edit/${dn}`);

			} catch(error) {
				console.error('Erreur:', error);
				res.status(500).send({ message: 'Erreur lors de la mise à jour de l\'attribut', error: error.message });
			} finally {
				// Déconnexion du client LDAP
				if (client) {
					client.unbind();
				}
			}
		});

		// Lancer le serveur
		app.listen(config.nodeJsPort, () => {
			console.log(`Serveur en écoute sur http://localhost:${config.nodeJsPort}`);
		});
	} catch (error) {
		logger.error('Erreur lors du chargement du schéma LDAP:', error);
		process.exit(1); // Optionnel : quittez le processus en cas d'erreur
	}
})();
