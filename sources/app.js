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
    rawSearchLDAP,
    getUserRoleFromDatabase,
    getObjectClass,
    updateAttributeConfigInLDAP,
} = require('./utils/ldapUtils');
const createLogger = require('./utils/log');

// Chargement de la configuration  
const configPath = path.join(__dirname, 'config.json');
let config = {};

const app = express();
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
        const objectData = (await searchLDAP(client, dn, options))[0];

	if (objectData.length === 0) {
             throw new Error(`Objet ${dn} non trouvé`); // Lancer une erreur vers le catch
        }

	// On élimie l'objectClass 'top'
	const objectClassesToSearch = objectData.objectClass.filter(element => element !== 'top');

	const searchPromises = objectClassesToSearch.map(objectClassName => {
	    // Récupérer la définition de chaque objectClass
	    return getObjectClass(config, objectClassName);
	});

	// Attendre que toutes les recherches soient terminées
	const objectClassesDetails = await Promise.all(searchPromises);

	// Rechercher des contrôles d'attributs dans l'arborescence LDAP config.configDn.attributs+root
	const attrDefDN = config.configDn.attributs + ',' + config.configDn.root;
	const attrDefOptions = {
	    //filter: '(cn=*)',
            scope: 'one',
            attributes: [ 'cn', 'l', 'description' ]
        };

	const attributes = await searchLDAP(client, attrDefDN, attrDefOptions);
	if (!attributes.length) {
	    throw new Error(`Objet ${dn} non trouvé`); // Lancer une erreur vers le catch
	}

	// Ajout les values d'attributs de l'entry dn dans les objectClasses contenus:
	objectClassesDetails.forEach(objectClass => {
	    ['MUST', 'MAY'].forEach(key => {
		Object.keys(objectClass[key]).forEach(attr => {
		    // Ajour des valeurs de l'entrée à éditer
        	    objectClass[key][attr] = { type: key, values: objectData[attr] || null };

		    // Ajout de la propriété customType à chaque attribut
		    objectClass[key][attr].customWording = attributes.find(item => item.cn.includes(attr))?.l || null;
		    objectClass[key][attr].valueCheck = attributes.find(item => item.cn.includes(attr))?.description || null;
		});
	    });
	});

//console.log('objectClassesDetails: ', JSON.stringify(objectClassesDetails, null, 2)); // Display for debug
	return res.render('edit', { dn, objectClassesDetails: objectClassesDetails });

    } catch (error) {
        console.error('Erreur de recherche de l\'entrée dans la base:', error);
        return res.status(500).send(error.message); // Renvoyer le message d'erreur  
    } finally {
	if (client) {
            client.unbind(); // Assurez-vous que le client est délié  
	}
    }
});

// ***********************************************************
// Route pour valider les contrôle d'attribut édités dans la modale
app.post('/update-attributeCtl', async (req, res) => {
    const client = ldap.createClient({ url: `${config.ldap.url}:${config.ldap.port}` }); // Déclaration du client de connexion
    let dn;

    try {
        // Connexion au serveur LDAP 
        await bindClient(client, config.ldap.data.bindDN, config.ldap.data.bindPassword);

        // Mettre à jour l'attribut dans LDAP
	const keys = Object.keys(req.body);
	for (let key of keys) {
	    if( key === 'dn') {
		dn = req.body[key];
	    } else {
         	let attrConf = req.body[key];
         	await updateAttributeConfigInLDAP(client, key, attrConf);
        }   }

        // Répondre avec succès
        //res.status(200).send('Attribut mis à jour avec succès');

        // Redirigez vers la page d'édition
        //return res.redirect(`/edit/${encodeURIComponent(dn)}`);
        return res.redirect(`/edit/${dn}`);

    } catch (error) {
        console.error('Erreur:', error);
        res.status(500).send(error.message);
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
