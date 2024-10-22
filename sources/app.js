const express = require('express');
const ldap = require('ldapjs');
const bodyParser = require('body-parser');
const fs = require('fs');
const path = require('path');
const {
    getObjectClasses,
    enrichObjectClassesDetails,
    updateAttributeConfigInLDAP,
} = require('./utils/ldapUtils');

// Chargement de la configuration  
const configPath = path.join(__dirname, 'config.json');
let config = {};

const app = express();
const port = 3000;

// Middleware  
app.use(bodyParser.json()); // Pour traiter les JSON 
app.use(bodyParser.urlencoded({ extended: true })); // Pour parser les données de formulaire
app.set('view engine', 'ejs');

// Fonction pour charger la config  
const loadConfig = () => {
    if (fs.existsSync(configPath)) {
        const data = fs.readFileSync(configPath);
        config = JSON.parse(data);

	if (config.configDn.root.indexOf(',') == -1 )
	    config.configDn.root = "ou=carnetLDAP,ou=applications," + config.ldap.base.baseDN;
	config.configDn.root = 'ou' + config.configDn.root.substring(config.configDn.root.indexOf('='));
	config.configDn.attributs = 'ou=' + config.configDn.attributs.substring(config.configDn.attributs.indexOf('=')!==-1 ?config.configDn.attributs.indexOf('=')+1 :0);
	if (config.configDn.attributs.indexOf(',') !== -1)
	    config.configDn.attributs = config.configDn.attributs.substring(0, config.configDn.attributs.indexOf(','));
    } else {
        // Création du fichier config.json avec des valeurs par défaut  
	const baseDN = "dc=example,dc=com";
        config = {
            ldap: {
                url: "ldap://localhost:389",                  // URL du serveur LDAP  
                base: {
                    bindDN: "cn=admin," + baseDN,             // DN pour l'authentification  
                    bindPassword: "password",                 // Mot de passe pour l'authentification  
                    baseDN: baseDN                            // DN de base pour les recherches  
                },
                schema: {
                    baseDN: "cn=schema",                      // DN pour le schéma LDAP  
                    bindDN: "cn=admin," + baseDN,             // DN pour l'authentification au schéma  
                    bindPassword: "schemaPassword"            // Mot de passe pour l'authentification au schéma  
                }
            },
	    configDn: {
		root: "ou=carnetLDAP,ou=application," + baseDN,
		attributs: "ou=attribut"
	    }
        };
        fs.writeFileSync(configPath, JSON.stringify(config, null, 2)); // Sauvegarde des valeurs par défaut dans config.json  
    }
};

// Chargement initial de la configuration  
loadConfig();

// Route de déconnexion  
app.get('/logout', (req, res) => {
    config.ldap.base.bindPassword = ""; // Réinitialiser le mot de passe  
    res.redirect('/');
});

// Page principale  
app.get('/', (req, res) => {
    if (!config.ldap.url || !config.ldap.base.bindDN || !config.ldap.base.baseDN || !config.ldap.base.bindPassword) {
        return res.render('search', { results: null, error: 'Vous devez configurer les informations LDAP (fichier: config.json).' });
    }
    res.render('search', { results: null, error: null });
});

// Route de recherche  
app.post('/search', (req, res) => {
    const searchTerm = req.body.searchTerm;

    // Vérifiez que la configuration est définie  
    if (!config.ldap.url || !config.ldap.base.bindDN || !config.ldap.base.baseDN || !config.ldap.base.bindPassword) {
        return res.render('search', { results: null, error: 'ADMIN: vous devez configurer les informations LDAP dans config.json.' });
    }

    // Créer un client LDAP  
    const client = ldap.createClient({ url: config.ldap.url });

    // Définir le callback de liaison  
    const bindCallback = (err) => {
        if (err) {
            console.error('Erreur de connexion:', err);
            return res.render('search', { results: null, error: 'Erreur de connexion à LDAP' });
        }

        const opts = {
            filter: `(&(objectClass=person)(|(uid=${searchTerm})(cn=${searchTerm})(sn=${searchTerm})(givenName=${searchTerm})(employeeNumber=${searchTerm})))`,
            scope: 'sub',
            attributes: ['dn', 'uid', 'cn', 'sn', 'o', 'telephoneNumber', 'mail']
        };

        // Utiliser le DN de base depuis la configuration  
        client.search(config.ldap.base.baseDN, opts, (err, searchRes) => {
            if (err) {
                console.error('Erreur de recherche:', err);
                client.unbind();
                return res.render('search', { results: null, error: 'Erreur de recherche LDAP' });
            }

            let results = [];

            searchRes.on('searchEntry', (entry) => {
                const attributes = entry.pojo.attributes.reduce((acc, attr) => {
                    acc[attr.type] = attr.values[0]; // Ajoute la première valeur pour chaque type d'attribut  
                    return acc;
                }, {});
                attributes.dn = entry.pojo.objectName; // Ajouter le DN à l'objet d'attributs  
                results.push(attributes); // Ajoute l'objet d'attributs au tableau des résultats  
            });

            searchRes.on('end', (result) => {
                client.unbind();
                return res.render('search', { results, error: null });
            });

            searchRes.on('error', (err) => {
                console.error('Erreur de recherche:', err);
                client.unbind();
                return res.status(500).send('Erreur de recherche');
            });
        });
    };

    // Faire le bind avec le DN et le mot de passe pour ldap://  
    client.bind(config.ldap.base.bindDN, config.ldap.base.bindPassword, bindCallback);
});

// Route pour éditer un objet  
app.get('/edit/:dn', (req, res) => {
    const dn = req.params.dn; // Récupérer le DN des paramètres de l'URL

    // Vérifiez que la configuration est définie  
    if (!config.ldap.url || !config.ldap.base.baseDN || !config.ldap.base.bindDN || !config.ldap.base.bindPassword || !config.ldap.schema.baseDN|| !config.ldap.schema.bindDN || !config.ldap.schema.bindPassword || !config.configDn.root || !config.configDn.attributs) {
        return res.render('search', { results: null, error: 'Vous devez configurer les informations LDAP (fichier: config.json).' });
    }

    // Créer un client pour interroger les objets  
    const objectClient = ldap.createClient({ url: config.ldap.url });

    // Faire le bind avec le DN et le mot de passe pour le client des objets  
    objectClient.bind(config.ldap.base.bindDN, config.ldap.base.bindPassword, (err) => {
        if (err) {
            console.error('Erreur de connexion au client des objets:', err);
            return res.status(500).send('Erreur de connexion au serveur LDAP');
        }

        const options = {
            scope: 'base', // Recherche unique sur le DN spécifié  
            attributes: ['*'] // Attributs à récupérer  
        };

        objectClient.search(dn, options, (err, search) => {
            if (err) {
                console.error('Erreur de recherche:', err);
                objectClient.unbind();
                return res.status(500).send('Erreur de recherche dans LDAP');
            }

            let objectData = null;

            search.on('searchEntry', (entry) => {
                objectData = entry.pojo; // Utiliser entry.pojo pour accéder aux attributs  
            });

            search.on('end', () => {
                if (objectData) {
                    // Extraire les classes d'objet  
                    const objectClassesNameList = objectData.attributes.find(attr => attr.type === 'objectClass')?.values || [];

		    // Appel de la fonction pour récupérer les attributs des objectClasses
		    getObjectClasses(config, objectClassesNameList, (err, objectClassesDetails) => {
 		        if (err) {
			    return res.status(500).send(err.message); // Utilisation du message d'erreur  
			}

			// Ajout à objectClassesDetails des valeurs contenues dans objectData:
			objectClassesDetails = enrichObjectClassesDetails(objectClassesDetails, objectData);

//console.log('objectData', objectData); // Pour débogage
//console.log('objectClassesDetails: ', JSON.stringify(objectClassesDetails,null, 2) ); // Pour débogage

			// Rechercher dans l'arborescence config.configDn.root de LDAP la definition des attributs
			const attrDefDN = config.configDn.attributs + ',' + config.configDn.root;
			const attrDefOptions = {
			    //filter: '(cn=*)',
                            scope: 'one',
                            attributes: ['*']
                        };

                        objectClient.search(attrDefDN, attrDefOptions, (err, attrDefSearch) => {
                            if (err) {
                                console.error(`Erreur de recherche de ${attrDefDN}:`, err);
                                objectClient.unbind();
                                return res.status(500).send(`Erreur de recherche dans LDAP pour ${attrDefDN}`);
                            }

                            objectData = [];

                            attrDefSearch.on('searchEntry', (entry) => {
				const attributes = entry.pojo.attributes.reduce((acc, attr) => {
				    acc[attr.type] = attr.values[0]; // Ajoute la première valeur pour chaque type d'attribut  
				    return acc;
				}, {});
				objectData.push(attributes); // Ajoute l'objet d'attributs au tableau des résultats  
                            });

                            attrDefSearch.on('end', () => {
                                objectClient.unbind(); // Fermer la connexion ici après toutes les recherches  

//console.log('attrDefDN: ', attrDefDN); // Pour débogage
//console.log('attrDefOptions: ', attrDefOptions); // Pour débogage
//console.log('objectData: ', objectData); // Pour débogage

				if (objectData) {
				    // Ajout de la propriété customType à chaque attribut
				    objectClassesDetails.forEach(objectClass => {
   	 				Object.keys(objectClass).forEach(attr => {
					    objectClass[attr].customWording = objectData.find(item => item.cn === attr)?.l || null;
					    objectClass[attr].valueCheck = objectData.find(item => item.cn === attr)?.description || null;
    					});
				    });
console.log('objectClassesDetails: ', JSON.stringify(objectClassesDetails,null, 2) ); // Pour débogage

				    // Rendre la vue avec les détails des classes d'objets
                		    return res.render('edit', { dn, objectClassesDetails });
                                } else {
                                    return res.status(404).send(`${attrDefDN} non trouvé`);
                                }
                            });

                            attrDefSearch.on('error', (err) => {
                                console.error(`Erreur de recherche ${attrDefDN}:`, err);
                                objectClient.unbind();
                                res.status(500).send(`Objet ${attrDefDN} non trouvé`);
                            });
                        });
		    });
                } else {
                    objectClient.unbind(); // Fermer la connexion si aucun objet n'est trouvé
                    res.status(404).send(`Objet ${dn} non trouvé`);
                }
            });

            search.on('error', (err) => {
                console.error('Erreur de recherche:', err);
                objectClient.unbind();
                res.status(500).send('Erreur de recherche dans LDAP');
            });
        });
    });
});

app.post('/update-attributeCtl', async (req, res) => {
    const client = ldap.createClient({ url: config.ldap.url }); // Déclaration du client de connexion
    let dn;

    try {
        // Connexion au serveur LDAP 
        await new Promise((resolve, reject) => {
            client.bind(config.ldap.base.bindDN, config.ldap.base.bindPassword, (err) => {
                if (err) {
                    return reject(new Error('Échec de la liaison LDAP : ' + err.message));
                }
                resolve();
            });
        });

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
        //res.json({ success: true, message: 'Attribut mis à jour avec succès' });

        // Redirigez vers la page d'édition
        //return res.redirect(`/edit/${encodeURIComponent(dn)}`);
        return res.redirect(`/edit/${dn}`);

    } catch (error) {
        console.error('Erreur:', error);
        res.status(500).json({ success: false, message: 'Erreur lors de la mise à jour de l\'attribut' });
    } finally {
        // Déconnexion du client LDAP  
        client.unbind();
    }
});

// Lancer le serveur  
app.listen(port, () => {
    console.log(`Serveur en écoute sur http://localhost:${port}`);
});
