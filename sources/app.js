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
    getUserRoleFromDatabase,
    getObjectClasses,
    enrichObjectClassesDetails,
    updateAttributeConfigInLDAP,
} = require('./utils/ldapUtils');
const createLogger = require('./utils/log');

// Chargement de la configuration  
const configPath = path.join(__dirname, 'config.json');
let config = {};

const app = express();
const defaultPort = 3000;

// Fonction pour charger et vérifier la config  
const loadConfig = () => {
    if (fs.existsSync(configPath)) {
        const data = fs.readFileSync(configPath);
        config = JSON.parse(data);

	config.nodeJsPort ||= defaultPort;
	config.ldap.url ||= "ldap://localhost:389";
	if (config.configDn.root.indexOf(',') == -1 )
	    config.configDn.root = "ou=carnetLDAP,ou=applications," + config.ldap.base.baseDN;
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
		url: "ldap://localhost:389",			// URL du serveur LDAP
		base: {
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
    const dn = req.cookies.dn || ''; // Lire le DN du cookie, s'il existe

    // Rendre la vue de connexion avec le login précédent
    res.render('login', { dn, error: null });
});


// ***********************************************************
// Route pour traiter la soumission du formulaire de connexion  
app.post('/login', (req, res) => {
    const { dn, password } = req.body;

    // Créer un client LDAP  
    const client = ldap.createClient({ url: config.ldap.url });

    try {
	// Tenter de se connecter au serveur LDAP avec les identifiants de l'utilisateur  
        await bindClient(client, dn, password);

        // Authentification réussie  
        // Maintenant, établir une nouvelle connexion avec le bindDN et le bindPassword de la configuration  

	// Authentification réussie, maintenant récupérer le rôle de l'utilisateur 
        client.unbind();

	// Récupérer le rôle de l'utilisateur  
        const role = await getUserRoleFromDatabase(dn);
        
        // Stocker les informations de l'utilisateur dans la session  
        req.session.user = {
            dn,
            role  
        };

        // Créer un nouveau client LDAP avec les informations de configuration  
        const appClient = ldap.createClient({ url: config.ldap.url });

        // Tenter de se lier avec le DN et le mot de passe de l'application  
        await bindClient(appClient, config.ldap.base.bindDN, config.ldap.base.bindPassword);

        // Authentification de l'application réussie  
        // Vous pouvez stocker le client de l'application dans la session, si nécessaire  
        req.session.appClient = appClient;

        // Mémoriser le dernier login dans un cookie  
        res.cookie('dn', dn, { maxAge: 24 * 60 * 60 * 1000 }); // Expire dans 1 jour

        // Rediriger vers la page d'accueil ou une autre page de votre application  
        res.redirect('/home'); // Remplacez '/home' par votre route principale  

    } catch (err) {
        console.error('Erreur de connexion LDAP:', err);
        return res.render('login', { dn, error: 'Nom d\'utilisateur ou mot de passe incorrect.' });
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
// Route de recherche  
app.post('/search', async (req, res) => {
    const searchTerm = req.body.searchTerm;

    // Créer un client LDAP  
    const client = ldap.createClient({ url: config.ldap.url });

    const opts = {
	filter: `(&(objectClass=person)(|(uid=${searchTerm})(cn=${searchTerm})(sn=${searchTerm})(givenName=${searchTerm})(employeeNumber=${searchTerm})))`,
	scope: 'sub',
	attributes: ['dn', 'uid', 'cn', 'sn', 'o', 'telephoneNumber', 'mail']
    };

    try {
        await bindClient(client, config.ldap.base.bindDN, config.ldap.base.bindPassword);

	const rawResults = await searchLDAP(client, config.ldap.base.baseDN, opts);

	const results = rawResults.map(entry => {
            const attributes = entry.attributes.reduce((acc, attr) => {
                acc[attr.type] = attr.values[0]; // Prendre la première valeur pour chaque attribut  
                return acc;
            }, {});
            attributes.dn = entry.objectName; // Ajouter le DN à l'objet d'attributs  
            return attributes; // Retourner l'objet d'attributs formaté  
        });

        client.unbind();
	return res.render('search', { results, error: null });

    } catch (error) {
	console.error('Erreur:', error);
	if (client) {
            client.unbind(); // Assurez-vous que le client est délié  
	}
	return res.render('search', { results: null, error: error.message });
    }
});

// ***********************************************************
// Route pour éditer un objet  
app.get('/edit/:dn', async (req, res) => {
    const dn = req.params.dn; // Récupérer le DN des paramètres de l'URL
    const client = ldap.createClient({ url: config.ldap.url });


    const options = {
	scope: 'base', // Recherche unique sur le DN spécifié  
	attributes: ['*'] // Attributs à récupérer  
    };

    try {
	// Liaison au client LDAP  
        await bindClient(client, config.ldap.base.bindDN, config.ldap.base.bindPassword);

        const objectData = await searchLDAP(client, dn, options);;
	if (rawResults.length === 0) {
             throw new Error(`Objet ${dn} non trouvé`); // Lancer une erreur vers le catch
        }

	// Extraire les noms des objetClass de l'entrée trouvée
	const objectClassesNameList = objectData.attributes.find(attr => attr.type === 'objectClass')?.values || [];

	// Appel de la fonction pour récupérer les attributs des objectClasses
	const objectClassesDetails = await getObjectClasses(config, objectClassesNameList);

	// Ajout à objectClassesDetails des values d'attributs contenues dans objectData, recherche de l'entry dn:
	const enrichedObjectClassesDetails = enrichObjectClassesDetails(objectClassesDetails, objectData);

//console.log('objectData', objectData); // Pour débogage
//console.log('objectClassesDetails: ', JSON.stringify(objectClassesDetails,null, 2) ); // Pour débogage

	// Rechercher des définitions des contrôles d'attributs dans l'arborescence LDAP config.configDn.attributs
	const attrDefDN = config.configDn.attributs + ',' + config.configDn.root;
	const attrDefOptions = {
	    //filter: '(cn=*)',
            scope: 'one',
            attributes: ['*']
        };

	const attrDefResults = await searchLDAP(client, attrDefDN, attrDefOptions);
	if (!attrDefResults.length) {
	    throw new Error(`Objet ${dn} non trouvé`); // Lancer une erreur vers le catch
	}

	const attributes = attrDefResults.attributes.reduce((acc, attr) => {
	    acc[attr.type] = attr.values[0]; // Ajoute la première valeur pour chaque type d'attribut  
	    return acc;
	}, {});

//console.log('attrDefDN: ', attrDefDN); // Pour débogage
//console.log('attrDefOptions: ', attrDefOptions); // Pour débogage
//console.log('objectData: ', objectData); // Pour débogage

	// Ajout de la propriété customType à chaque attribut
	enrichedObjectClassesDetails.forEach(objectClass => {
	    Object.keys(objectClass).forEach(attr => {
		objectClass[attr].customWording = attributes.find(item => item.cn === attr)?.l || null;
		objectClass[attr].valueCheck = attributes.find(item => item.cn === attr)?.description || null;
    	    });
	});
console.log('objectClassesDetails: ', JSON.stringify(objectClassesDetails,null, 2) ); // Pour débogage

	client.unbind(); // Fermer la connexion si aucun objet n'est trouvé
	return res.render('edit', { dn, objectClassesDetails: objectClassesDetailsArray });

    } catch (error) {
        console.error('Erreur de recherche de l\'entrée dans la base:', error);
	if (client) {
            client.unbind(); // Assurez-vous que le client est délié  
	}
        return res.status(500).send(error.message); // Renvoyer le message d'erreur  
    }
});

// ***********************************************************
// Route pour valider les contrôle d'attribut édités dans la modale
app.post('/update-attributeCtl', async (req, res) => {
    const client = ldap.createClient({ url: config.ldap.url }); // Déclaration du client de connexion
    let dn;

    try {
        // Connexion au serveur LDAP 
        await bindClient(client, config.ldap.base.bindDN, config.ldap.base.bindPassword);

        // Mettez à jour l'attribut dans LDAP
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
