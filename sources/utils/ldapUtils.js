const ldap = require('ldapjs');
const config = require('../config.json'); // Assurez-vous d'importer votre fichier de configuration

/**
 * Vérifie l'existence de la branche racine dans LDAP et la crée si elle n'existe pas.
 * @returns {Promise<void>}
 */
async function checkAndCreateOrganizationalUnit(client, dn) {
    try {
	const dnExists = await checkDNExists(client, dn);
	if (dnExists) {
	    return true;
        }

	const sep = dn.indexOf(',');
        let root;
        let entryName;

        // Vérification de validité du DN
        if (sep === -1 || !dn.startsWith("ou=")) {
            throw new Error(`L'unité organisationnelle ${dn} à créer est incorrecte.`);
        }

        // Extraction de la racine et du nom de l'unité organisationnelle à créer
        root = dn.substring(sep + 1).trim(); // racine de création  
        entryName = dn.substring(dn.indexOf('=') + 1, sep).trim(); // unité organisationnelle

	if (await checkAndCreateOrganizationalUnit(client, root) && await createOrganizationalUnit(client, dn)) {
	    return true;
	}
	
	return false;

    } catch (err) {
        console.error(`Erreur dans checkAndCreateOrganizationalUnit : ${err.message}`);
	throw err; // Relance de l'erreur
    }

}

async function checkDNExists(client, dn) {
    return new Promise((resolve) => {
        client.search(dn, { scope: 'base' }, (err, res) => {
            if (err) {
                return resolve(false);
            }

            let exists = false;

            // Écouter les entrées de recherche  
            res.on('searchEntry', (entry) => {
                // Si nous recevons une entrée, cela signifie que le DN existe  
                exists = true;
            });

            // Écouter la fin de la recherche  
            res.on('end', (result) => {
                // Si le statut de la recherche n'est pas 0, cela peut indiquer qu'aucune entrée n'a été trouvée  
                if (result.status !== 0) {
                    resolve(false); // Résoudre avec false en cas d'erreur  
                }
                // Résoudre avec true ou false selon l'existence  
                resolve(exists);
            });

	    // Écouter les erreurs de recherche (au cas où)
            res.on('error', (error) => {
                resolve(false); // Résoudre avec false en cas d'erreur  
            });
        });
    });
}

async function bindClient(client) {
    return new Promise((resolve, reject) => {
        client.bind(config.ldap.base.bindDN, config.ldap.base.bindPassword, (err) => {
            if (err) {
                return reject(`Erreur lors de la liaison: ${err}`);
            }
            resolve();
        });
    });
}

// Fonction auxiliaire pour créer la branche racine
async function createOrganizationalUnit(client, dn) {

    const sep = dn.indexOf(',');
    let root;
    let entryName;

    try {
        // Vérification de validité du DN
        if (sep === -1 || !dn.startsWith("ou=")) {
            throw new Error(`L'unité organisationnelle ${dn} à créer est incorrecte.`);
        }

        // Extraction de la racine et du nom de l'unité organisationnelle à créer
        root = dn.substring(sep + 1).trim(); // racine de création  
        entryName = dn.substring(dn.indexOf('=') + 1, sep).trim(); // unité organisationnelle

        // Construction de l'entrée pour l'unité organisationnelle  
        const entry = {
            objectClass: ['top', 'organizationalUnit'],
            ou: entryName 
        };

        // Attente de l'ajout avec le client  
        await new Promise((resolve, reject) => {
            client.add(dn, entry, (err) => {
                if (err) {
                    return reject(err);
                }
                resolve();
            });
        });
        return true;

    } catch (err) {
        const errorEntryName = entryName || 'inconnu';
        const errorRoot = root || 'inconnu';
        throw new Error(`Échec de la création de l'unité organisationnelle ou=${errorEntryName} dans ${errorRoot}. Détails : ${err.message}`);
    }
}

/**
 * Met à jour un attribut dans LDAP sous la branche spécifiée.
 * @param {string} dn - Le DN de l'entrée à mettre à jour.
 * @param {Object} updates - Les modifications à appliquer.
 * @returns {Promise<void>}
 */
async function updateAttributeConfigInLDAP(client, attrName, attrConf) {
    try {
	const root = config.configDn.attributs + ',' + config.configDn.root;
	await checkAndCreateOrganizationalUnit(client, root);

	const dn = 'cn=' + attrName + ',' + root;
	const entry = {};
	entry.objectClass = ['top', 'applicationProcess'];
	entry.cn = attrName;
	if (attrConf.customWording) {
	    entry.l = attrConf.customWording; 
	}
	if (attrConf.valueCheck) {
	    entry.description = attrConf.valueCheck; 
	}

	const dnExists = await checkDNExists(client, dn);
	if (dnExists) {
	    // Si l'entrée existe, la supprimer
	    await new Promise((resolve, reject) => {
                client.del(dn, (err) => {
                    if (err) {
                        return reject(err);
                    }
                    resolve();
                });
            });
	}

	// Ajouter la nouvelle entrée d'attribut
        await new Promise((resolve, reject) => {
            client.add(dn, entry, (err) => {
                if (err) {
                    return reject(err);
                }
                resolve();
            });
        });
        return true;

    } catch (error) {
	throw new Error(`Erreur dans updateAttributeConfigInLDAP: ${error.message}`);
    }
}

/**
 * Fonction pour enrichir les détails des classes d'objets avec les valeurs d'une entrée LDAP.
 * @param {Array} objectClassesDetails - Tableau des détails des classes d'objets à enrichir.
 * @param {Object} entryPojo - L'objet contenant les attributs de l'entrée LDAP.
 * @returns {Array} - Tableau des détails des classes d'objets enrichis.
 */
function enrichObjectClassesDetails(objectClassesDetails, objectData) {
    // Convertir le tableau d'attributs de objectData en un objet d'accès facile  
    const attributesMap = objectData.attributes.reduce((acc, attr) => {
        acc[attr.type] = attr.values.length > 0 ? attr.values[0] : null; // Prendre la première valeur ou null  
        return acc;
    }, {});

    // Parcourir chaque classe d'objet dans objectClassesDetails  
    objectClassesDetails.forEach(objectClass => {
        // Pour chaque attribut MUST  
        objectClass.attributes.MUST.forEach(attr => {
            // Remplacement par un objet avec "type" (MUST) et "value"
            objectClass[attr] = {
                type: "MUST", // Mettre "MUST" comme type  
                value: attributesMap[attr] || null // Valeur trouvée ou null  
            };
        });

        // Pour chaque attribut MAY  
        objectClass.attributes.MAY.forEach(attr => {
            // Remplacement par un objet avec "type" (MAY) et "value"
            objectClass[attr] = {
                type: "MAY", // Mettre "MAY" comme type  
                value: attributesMap[attr] || null // Valeur trouvée ou null  
            };
        });

        // Optionnel : Vous pouvez supprimer les anciennes clés MAY et MUST si nécessaire  
        delete objectClass.attributes; // Pour supprimer les attributs d'origine  
    });

    return objectClassesDetails; // Retourner le tableau mis à jour  
}

// Fonction pour récupérer les attributs de chaque objectClass dans le schéma  
const getObjectClasses = (config, objectClassesNameList, callback) => {
    // Vérification de la configuration  
    if (!config.ldap || 
        !config.ldap.url || 
        !config.ldap.schema.baseDN || 
        !config.ldap.schema.bindDN || 
        !config.ldap.schema.bindPassword) {
        return callback(new Error('Vous devez configurer les informations LDAP.'),null);
    }

    const schemaClient = ldap.createClient({ url: config.ldap.url }); // Créer un client pour interroger le schéma

    // Effectuer le bind avec le DN et le mot de passe pour le client du schéma  
    schemaClient.bind(config.ldap.schema.bindDN, config.ldap.schema.bindPassword, (err) => {
        if (err) {
            console.error('Erreur de connexion au client du schéma:', err);
            return callback(new Error('Erreur de connexion au schéma LDAP.'),null);
        }

        let pendingRequests = objectClassesNameList.length; // Compteur pour gérer les requêtes asynchrones
	const objectClassesDetails = []; // Tableau pour stocker les résultats

        if (pendingRequests === 0) {
            schemaClient.unbind(); // Fermer la connexion au client du schéma  
            return callback(null,objectClassesDetails); // Si aucun objectClass, appelez le callback immédiatement  
        }

        objectClassesNameList.forEach(objectClass => {
	    if (objectClass === 'top') {
                        pendingRequests -= 1;
	    }else{
		const options = {
		    filter: "(olcObjectClasses=* NAME '" + objectClass + "' *)",
		    scope: 'sub',
		    attributes: ['olcObjectClasses'] // Récupérer tous les attributs  
		};

		let attributes = {};

		schemaClient.search(config.ldap.schema.baseDN, options, (err, search) => {
                    if (err) {
                        console.error(`Erreur lors de la recherche du schéma pour ${objectClass}:`, err);
                        pendingRequests -= 1;
                        if (pendingRequests === 0) {
                            schemaClient.unbind(); // Fermer la connexion au client du schéma  
                            callback(null,null); // Terminer le callback même en cas d'erreur  
                        }
                        return;
                    }

                    search.on('searchEntry', (entry) => {
                        attributes = entry.pojo.attributes.reduce((acc, attr) => {
                            acc[attr.type] = attr.values; // Stocke toutes les valeurs pour chaque type d'attribut  
                            return acc;
                        }, {});

		        attributes = attributes.olcObjectClasses.filter(line => line.includes("NAME '" + objectClass + "'"));
		        if(attributes){
			    const mustMatch = attributes[0].match(/MUST\s*\(\s*([^)]*)\s*\)/);
			    const mayMatch = attributes[0].match(/MAY\s*\(\s*([^)]*)\s*\)/);

			    // Étape 3: Nettoyer et formater les résultats
			    const mustAttributes = mustMatch ? mustMatch[1].split('$').map(attr => attr.trim()).filter(Boolean) : [];
			    const mayAttributes = mayMatch ? mayMatch[1].split('$').map(attr => attr.trim()).filter(Boolean) : [];
			    attributes = {MUST: mustAttributes, MAY: mayAttributes};

                            objectClassesDetails.push({ objectClassName: objectClass, attributes}); // Ajouter au tableau des résultats  
		        }
                    });

                    search.on('end', () => {
                        pendingRequests -= 1;
                        //objectClassesDetails.push({ objectClassName: objectClass, attributes: attributes.olcAttributeTypes}); // Ajouter au tableau des résultats  

                        if (pendingRequests === 0) {
			    schemaClient.unbind(); // Fermer la connexion au client du schéma  
                    	    return callback(null, objectClassesDetails); // Appeler le callback une fois toutes les requêtes terminées  
		        }
                    });

                    search.on('error', (err) => {
                        console.error('Erreur de recherche dans le schéma:', err);
                        pendingRequests -= 1;
                        if (pendingRequests === 0) {
                            schemaClient.unbind(); // Fermer la connexion au client du schéma  
                            return callback(null,objectClassesDetails); // Terminer le callback même en cas d'erreur  
                        }
                    });
		});
            }
        });
    });
};


module.exports = {
    getObjectClasses,
    enrichObjectClassesDetails,
    updateAttributeConfigInLDAP
};
