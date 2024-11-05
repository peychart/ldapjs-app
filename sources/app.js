const express = require('express');
const ldap = require('ldapjs');
const bodyParser = require('body-parser');
const cookieParser = require('cookie-parser');
const session = require('express-session');
const passport = require('passport');
const { Strategy: LdapStrategy } = require('passport-ldapauth');
const winston = require('winston');
const fs = require('fs');
const path = require('path');
const {
    bindClient,
    searchLDAP,
	updateLDAP,
    rawSearchLDAP,
    getUserRoleFromDatabase,
    getObjectClass,
	getAllMustAttributes,
    updateAttributeConfigInLDAP,
} = require('./utils/ldapUtils');
const {
	isEqual
} = require('./utils/utils');
const createLogger = require('./utils/log');

// Chargement de la configuration  
const configPath = path.join(__dirname, 'config.json');
let config = {};

const app = express();
app.use('/js', express.static(path.join(__dirname, 'public/js')));
const defaultNodePort = 3000;
const defaultLdapPort = 3000;

// Fonction pour charger et vérifier la config  
const loadConfig = () => {
    if (fs.existsSync(configPath)) {
        const data = fs.readFileSync(configPath);
        config = JSON.parse(data);

	config.nodeJsPort ||= defaultNodePort;
	config.ldap.url ||= "ldap://localhost";
	config.ldap.port ||= 389;
	if (config.configDn.root.indexOf(',') == -1 )
	    config.configDn.root = "ou=carnetLDAP,ou=applications," + config.ldap.data.baseDN;
	config.configDn.root = 'ou' + config.configDn.root.substring(config.configDn.root.indexOf('='));
	config.configDn.attributs = 'ou=' + config.configDn.attributs.substring(config.configDn.attributs.indexOf('=')!==-1 ?config.configDn.attributs.indexOf('=')+1 :0);
	config.logFile ||= "logs/application.log";
	config.sessionSecret ||= 'secret_complexe';
	if (config.configDn.attributs.indexOf(',') !== -1)
	    config.configDn.attributs = config.configDn.attributs.substring(0, config.configDn.attributs.indexOf(','));
    } else {
	// Création du fichier config.json avec des valeurs par défaut
	const baseDN = "dc=example,dc=com";
	const defaultConfig = {
	    nodeJsPort: defaultPort,				// Port du serveur http nodeJs
	    ldap: {
		url: "ldap://localhost",			// URL du serveur LDAP
		port: 389,					// URL du serveur LDAP
		data: {
		    bindDN: "cn=admin," + baseDN,		// DN pour l'authentification
		    bindPassword: "password",			// Mot de passe pour l'authentification 
		    baseDN: baseDN				// DN de base pour les recherches
		},
		schema: {
		    baseDN: "cn=schema",			// DN pour le schéma LDAP
		    bindDN: "cn=admin," + baseDN,		// DN pour l'authentification au schéma
		    bindPassword: "schemaPassword"		// Mot de passe pour l'authentification au schéma
		}
	    },
	    configDn: {
		root: "ou=carnetLDAP,ou=application," + baseDN,
		attributs: "ou=attribut"
	    },
	    logFile: "logs/application.log",
	    sessionSecret: "secret_complexe"
	};
	fs.writeFileSync(configPath, JSON.stringify(defaultConfig, null, 2)); // Sauvegarde des valeurs par défaut dans config.json
    }
};

// Chargement initial de la configuration  
loadConfig();
const logger = createLogger();

// Middleware  
app.use(bodyParser.json()); // Pour traiter les JSON 
app.use(bodyParser.urlencoded({ extended: true })); // Pour parser les données de formulaire
app.use(cookieParser());
app.use(session({
    secret: config.sessionSecret,
    resave: false,
    saveUninitialized: true,
    cookie: { maxAge: 4 * 60 * 60 * 1000 } // Durée de vie du cookie de session
}));

app.use(passport.initialize());
app.use(passport.session());

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
        const attributesToSearch = ['uid', 'mail', 'employeeNumber', 'sn', 'givenName',  'cn'];

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
        
        // Filtrer les résultats pour obtenir le DN  : extraire objectName pour le dn ...
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

        // Rediriger vers la page d'accueil ou une autre page de votre application  
        res.redirect('/search');

    } catch (err) {
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
        res.redirect('/'); // Rediriger vers la page de connexion  
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

	client.unbind();

	// Passer le searchTerm à la vue  
	return res.render('search', { results, searchTerm: searchTerm, error: null });

    } catch (error) {
	console.error('Erreur:', error);
	if (client) {
            client.unbind(); // Assurez-vous que le client est délié  
	}
	return res.render('search', { results: null, searchTerm: null, error: error.message });
    }
});

// Nouvelle route pour le Reset du formulaire search (POST)
app.post('/search-reset', (req, res) => {
    // Renvoyer la vue de recherche avec des résultats vides
    res.render('search', { results: null, searchTerm: req.body.searchTerm, error: null });
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

	// Récupration de l'entrée à éditer
        const objectData = (await searchLDAP(client, dn, options)
	    .catch(() => {
        	throw new Error(`Objet ${dn} non trouvé`); // Lancer une erreur vers le catch
            })
	)[0];

	// On élimie l'objectClass 'top'
	const objectClassesToSearch = objectData.objectClass.filter(element => element !== 'top');

	// Récupérer la définition de chaque objectClass
	const searchPromises = await Promise.all(objectClassesToSearch.map(async objectClassName => {
    	try {
        	const objectClass = await getObjectClass(config, objectClassName);
        	objectClass.MUST = await getAllMustAttributes(config, objectClass);
        	return objectClass;
    	} catch (error) {
        	console.error(`Erreur lors de la récupération de ${objectClassName} :`, error);
        	return {}; // Ou une valeur par défaut, si nécessaire  
    	}
	}));

	// Filtrer les résultats pour enlever les valeurs nulles  
	const objectClassesDetails = searchPromises.filter(classDetails => classDetails !== {});

	// Rechercher des contrôles d'attributs dans l'arborescence LDAP config.configDn.attributs+root
	const attrDefDN = config.configDn.attributs + ',' + config.configDn.root;
	const attrDefOptions = {
		//filter: '(cn=*)',
		scope: 'one',
		attributes: [ 'cn', 'l', 'description', 'ou' ]
	};

	const attributes = await searchLDAP(client, attrDefDN, attrDefOptions).catch (err => {
	    return [];
	});

	// Ajout les values d'attributs de l'entry dn dans les objectClasses contenus:
	objectClassesDetails.forEach(objectClass => {
		objectClass['ATTRIBUTE'] = {};
	    ['MUST', 'MAY'].forEach(key => {
			Object.keys(objectClass[key]).forEach(attr => {
				const forceMultiValue = attributes.find(item => item.cn.includes(attr))?.ou ?? null;
				const multiValue = (forceMultiValue && forceMultiValue[0] === 'MULTI-VALUE') || !!objectClass[key][attr]?.MULTIVALUE;

				// Ajout valuer(s) ajustée(s) du format SINGLE-VALUE ou MULTI-VALUE
				if (multiValue) {
					const values = Array.isArray(objectData[attr]) ? objectData[attr] : (objectData[attr] !== undefined ? [objectData[attr]] : []);
					objectClass['ATTRIBUTE'][attr] = { type: key, values: values };
				} else {
					const value = Array.isArray(objectData[attr]) 
					// Si le tableau n'est pas vide, prendre le premier élément, sinon null  
					? (objectData[attr].length > 0 ? objectData[attr][0] : null)
					// Retourne null si undefined  
					: objectData[attr] !== undefined ? objectData[attr] : null;
					objectClass['ATTRIBUTE'][attr] = { type: key, values: value };
				}

				// Ajout de la propriété customType à chaque attribut
				objectClass['ATTRIBUTE'][attr].customWording = attributes.find(item => item.cn.includes(attr))?.l || null;
				objectClass['ATTRIBUTE'][attr].valueCheck = attributes.find(item => item.cn.includes(attr))?.description || null;
				if (forceMultiValue !== null) objectClass['ATTRIBUTE'][attr].MULTIVALUE = multiValue;
			});
			delete objectClass[key];
	    });
	});

//console.clear(); console.log('objectClassesDetails: ', JSON.stringify(objectClassesDetails, null, 2)); // Display for debug
		return res.render('edit', {dn, objectClassesDetails: objectClassesDetails});

    } catch (error) {
        console.error('Fiche non trouvée:', error);
        return res.status(500).send(error.message); // Renvoyer le message d'erreur  
    } finally {
	if (client) {
            client.unbind(); // Assurez-vous que le client est délié  
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

        // Récupérer les clés du corps de la requête
		const tmp = {};
		const results = {};

console.log('req.body: ', req.body);

		// Dédoubler les réponses :
		Object.keys(req.body).forEach(key => {
			if (Array.isArray(req.body[key])) {
				tmp[key] = [...new Set(req.body[key])];
				if (tmp[key].length === 1 )
					tmp[key] = tmp[key][0];
			} else {
				tmp[key] = req.body[key];
			}
		});

		// Parse des inputs marqués avec '[]'
		Object.keys(tmp).forEach(key => {
            if (key.endsWith('[]')) {
				const baseKey = key.slice(0, -2); // Enlever '[]' du nom de clé  
                const value = tmp[key];

			// Si la valeur est un tableau, essayons de parser chaque élément  
                if (Array.isArray(value)) {
                    results[baseKey] = value.map(item => {
                        try {
                            return JSON.parse(item); // Parser chaque élément du tableau  
                        } catch (error) {
                            console.error(`Erreur lors du parsing de ${item}:`, error);
                            return item; // Retourner l'élément d'origine en cas d'erreur  
                        }
                    });
                } else {
                    // Si ce n'est pas un tableau, essayer de parser la valeur unique  
                    try {
                        results[baseKey] = JSON.parse(value); // Parser la valeur JSON  
                    } catch (error) {
                        console.error(`Erreur lors du parsing de ${value}:`, error);
                        results[baseKey] = value; // Retourner la valeur d'origine en cas d'erreur  
                    }
                }
            } else {
                // Pour les autres champs, conserver la valeur  
                results[key] = tmp[key];
            }
		});

		// Mise à jour de la base LDAP
		await updateLDAP(client, dn, results);

		return res.redirect(`/edit/${dn}`);

    } catch (error) {
        console.error('Erreur:', error);
        res.status(500).send({ error: error.message });
    } finally {
        // Déconnexion du client LDAP  
		if (client) {
	    	client.unbind();
		}
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

//console.log('req.body: ', JSON.stringify(req.body)); // Pour debug
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
//console.log('attrName: ', JSON.stringify(attrName)); // Pour debug
//console.log('attrConf: ', JSON.stringify(attrConf)); // Pour debug

        // Validation des données  
        if (!attrName) {
            return res.status(400).send('Données manquantes dans \'/update-attributeCtl/:dn\'.');
        }

		// Mise à jour dans la base LDAP
		await updateAttributeConfigInLDAP(client, attrName, attrConf);

		return res.redirect(`/edit/${dn}`);

    } catch (error) {
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
