/*	LDAP-editor (Version 0.1 - 2022/06)
	<https://github.com/peychart/croncpp>

	Copyright (C) 2022  -  peychart

	This program is free software: you can redistribute it and/or
	modify it under the terms of the GNU General Public License as
	published by the Free Software Foundation, either version 3 of
	the License, or (at your option) any later version.

	This program is distributed in the hope that it will be useful,
	but WITHOUT ANY WARRANTY; without even the implied warranty
	of MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.
	See the GNU General Public License for more details.

	You should have received a copy of the GNU General Public
	License along with this program.
	If not, see <http://www.gnu.org/licenses/>.

	Details of this licence are available online under:
						http://www.gnu.org/licenses/gpl-3.0.html
*/
const express = require('express');
const ldap = require('ldapjs');
const path = require('path');
//const configPath = path.join(__dirname, 'config.json');
const bodyParser = require('body-parser');
const cookieParser = require('cookie-parser');
const session = require('express-session');
const passport = require('passport');
const { Strategy: LdapStrategy } = require('passport-ldapauth');
//const winston = require('winston');
//const createLogger = require('./utils/log');
const { createLogger, format, transports } = require('winston');
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

const app = express();
let config;

// Chargement initial de la configuration
(async () => {
	// Chargement initial de la configuration
	const logger = createLogger({
level: 'error', // 'info' Niveau de log par défaut
	format: format.combine(
		format.timestamp(),
		format.json()
	),
	transports: [
		new transports.Console(), // Journalisation dans la console
		new transports.File({ filename: 'error.log', level: 'error' }), // Journalisation des erreurs dans un fichier
	],
});
	config = loadConfig();

	try {
		// Récupération du schéma LDAP
		const ldapSchema = await loadSchema(ldap, config);

//console.log('ldapSchema: ', JSON.stringify(ldapSchema, null, 2));	// Pour debug

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
					throw new Error('Nom d\'utilisateur ou mot de passe incorrect.');
				} else if (validResults.length > 1) {
					const allEqual = validResults.every(dn => dn === validResults[0]);
					if (!allEqual) {
						throw new Error('Plus d\'une occurrence d\'identifiant trouvée ! Veuillez préciser davantage votre login.');
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
			res.render('search', { results: null, searchTerm: req.body.searchTerm, error: null, ldapSchema: ldapSchema });
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

				// Passer le searchTerm à la vue avec un statut 200 (OK)
				return res.status(200).render('search', { results, searchTerm: req.body.searchTerm, error: null, ldapSchema: ldapSchema });

			} catch(error) {
					console.error('Erreur:', error);
				if (client) {
					client.unbind(); // Assurez-vous que le client est délié
				}
				// Passer l'erreur à la vue avec un statut 500 (Erreur interne du serveur)
				return ress.status(500).render('search', { results: null, searchTerm: null, error: error.message, ldapSchema: ldapSchema });
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

		// Route de définition des recherches (POST)
		app.post('/searchDef', async (req, res) => {

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

				// Passer le searchTerm à la vue avec un statut 200 (OK)
				return res.status(200).render('search', { results, searchTerm: req.body.searchTerm, error: null, ldapSchema: ldapSchema });

			} catch(error) {
				;
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

		/* *****************************
		 * Route d'édition de l'oject dn
		 */
		app.get('/newEdit/:dn', async (req, res) => {
			const dn = req.params.dn;
			delete req.session.edit;

			return res.redirect(`/edit/${dn}`);
			//return res.redirect(`/edit/${dn}`);
		});

		app.get('/edit/:dn', async (req, res) => {
			const dn = req.params.dn; // Récupérer le DN des paramètres de l'URL
			const client = ldap.createClient({ url: `${config.ldap.url}:${config.ldap.port}` });

			try {let objectData;

				// Liaison au client LDAP
				await bindClient(client, config.ldap.data.bindDN, config.ldap.data.bindPassword);

				// Récupération des Data à éditer
				objectData = req.session.edit?.objectData;

//console.clear(); console.log('\nreq.session.edit: ', req.session.edit);	// Pour debug

				if (!objectData) {
					const options = {
						scope: 'base', // Recherche unique sur le DN spécifié
						attributes: ['*'] // Attributs à récupérer
					};

					// Récupration de l'entrée dn à éditer
					objectData = (await searchLDAP(client, dn, options)
						.catch(() => {
							throw new Error(`Objet ${dn} non trouvé`); // Lancer une erreur vers le catch
						})
					)[0];
				}

//console.clear(); console.log('objectData: ', JSON.stringify(objectData, null, 2)); // Display for debug

				// On élimie l'objectClass === 'top'
				const objectClassesToSearch = [
					...(objectData?.objectClass.filter(item => item !== 'top') || []),
					...(req.session.edit?.ADDED || [])
				]; if (!objectClassesToSearch.length)
					throw new Error('DN à éditer vide: création ?...');

				// Récupérer la définition de chaque objectClass composant notre dn à éditer
				const objectClassesDetails = objectClassesToSearch.map(objectClassName => {
					try {
						const cls = getObjectClassByName(ldapSchema, objectClassName);
						const objCls = setInheritedMustAttributes(ldapSchema, cls);
						return enrichObjectClassWithAttributes(ldapSchema, objCls);
					} catch(error) {
						console.error(`Erreur lors de la récupération de ${objectClassName} :`, error);
						return null; // Ou une valeur par défaut, si nécessaire
					}
				});

				// Ajouter la propriété ADDED/DELEETD=true aux objectClasses éventuellement concernés
				['ADDED', 'DELETED'].forEach(type => {
					objectClassesDetails.forEach(objCls => {
						if (req.session.edit?.[type])
							if (req.session.edit[type].includes(objCls.NAME[0])) objCls[type]=true;
					});
					if (req.session.edit?.[type]) delete req.session.edit[type];
				});

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
				//		1: avec les éventuelles customConf d'attributs définies dans attributesConfig
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

//console.clear(); console.log('objectData: ', JSON.stringify(objectData, null, 2)); // Display for debug
				//		2: avec les data d'objectData de chaque attribut
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
//console.clear(); console.log('EnrichObjectClassesDetails: ', JSON.stringify(objectClassesDetails, null, 2)); // Display for debug

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
			const dn = req.params.dn; // Assignation de dn depuis les paramètres de l'URL;
			let objectData;
			let objectClassesEdition = false;

			try {
				// Connexion au serveur LDAP
				await bindClient(client, config.ldap.data.bindDN, config.ldap.data.bindPassword);

				// Fonction parse JSON sécurisée
				const safeJSONParse = (val) => {
					try{
						return JSON.parse(val);
					} catch(error) {
						// En cas d'erreur : retourne la valeur d'origine en string pour LDAP-JS
						return (typeof val !== 'string') ?JSON.stringify(val) :val;
				}	};

//console.clear(); console.log('req.body: ', JSON.stringify(req.body, null, 2), '\n\n');	// Pour debug

				// Traitement de la réponse
				objectData = Object.keys(req.body).reduce((acc, key) => {
					// Ajout/suppression d'objectClasses
					if (key.startsWith('reload')) {
						objectClassesEdition = true;
						return acc;
					}
					if ( key.endsWith('Added') || key.endsWith('Deleted')) {
						const statusKey = key.endsWith('Deleted') ? 'DELETED' : 'ADDED';
						req.session.edit = {
							...req.session.edit,
							 [statusKey]: (req.session.edit?.[statusKey] || []).concat(req.body[key])
						};
						objectClassesEdition = true;
						return acc;
					}

					// Dédoubler les champs input dupliquées entre onglets :
					//	on retient le premier élément du getElementByName...
					let value = (key.startsWith('objectClass') || !Array.isArray(req.body[key]))
						?req.body[key]
						:req.body[key][0];

					value = Array.isArray(value) ?value.map(safeJSONParse) :safeJSONParse(value);
//console.log(key, ` : `, value); // Pour debug

					let baseKey;
					// Parse des clées multiValeurs (de valeurs Array[])
					if (key.endsWith('_multiValues')) {
						// Rétablir le nom d'attribut
						baseKey = key.substring(0, key.indexOf('_'));

						// Si la valeur est bien un tableau, parser ses valeurs
						//value = Array.isArray(value) ?value.map(safeJSONParse) :(safeJSONParse(value));
						//value = noEmpty(value);
					} else baseKey = key;

					if (Array.isArray(value)) {
						if (value.length > 0)
							acc[baseKey] = value;
					} else if (value != null && value !== '')
						acc[baseKey] = [(typeof value === 'string') ?value :JSON.stringify(value)];

					return acc;
				}, {});

//console.log('req.session.edit: ', JSON.stringify(req.session.edit, null, 2));	// Pour debug
//console.log('\n\nobjectData: ', objectData);	// Pour debug

				if (objectClassesEdition) {
					throw 255;
				} else {
					// Mise à jour de la base LDAP
					if (!objectData.objectClass.includes('top')) objectData.objectClass.push('top');
					await updateLDAP(client, dn, objectData);
				}

				// Redirection vers la page d'édition du dn
				//return res.redirect(`/edit/${dn}?errMsg=${encodeURIComponent(req.session.edit?.errMsg || '')}`);
				return res.status(200).redirect(`/newEdit/${dn}`);
				//return res.redirect(`/edit/${dn}`);
			} catch(err) {
				if (err.code === 255 || err === 255 ) {						// Poursuite de l'édition du dn
					req.session.edit = {...req.session.edit, objectData: objectData};
					return res.redirect(`/edit/${dn}?errMsg=${encodeURIComponent(req.session.edit?.errMsg || '')}`);
					//return res.redirect(`/edit/${dn}`);
				} else {
					console.error('Erreur d\'édition :', err);
					res.status(500).send({ error: err.message });
				}
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
					} else if (key === 'attributeType') { // MULTI-VALUES ?
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

				return res.redirect(`/newEdit/${dn}?errMsg=${encodeURIComponent(req.session.edit?.errMsg || '')}`);
				//return res.redirect(`/edit/${dn}`);

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
		process.exit(2); // Optionnel : quittez le processus en cas d'erreur
	}
})();
