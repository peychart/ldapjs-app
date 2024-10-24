const ldap = require('ldapjs');
const config = require('../config.json'); // Assurez-vous d'importer votre fichier de configuration


/**
 * Récupération du rôle de l'utilisateur dans l'arborescence LDDAP: config.configDn
 */
function getUserRoleFromDatabase(dn) {

    // A FAIRE A FAIRE A FAIRE A FAIRE A FAIRE A FAIRE A FAIRE A FAIRE ...

    return( { "dn": "", "role": "guest"} );
}

async function bindClient(client, bindDN, bindPassword) {
    return new Promise((resolve, reject) => {
        client.bind(bindDN, bindPassword, (err) => {
            if (err)
                return reject(err.message);
	    resolve();
        });
    });
}

/**
 * Effectue une recherche dans LDAP.
 * @param {Object} client - Le client LDAP.
 * @param {string} baseDN - Le DN de base pour la recherche.
 * @param {Object} options - Les options de recherche, y compris le filtre et les attributs.
 * @returns {Promise<Array>} - Une promesse qui résout un tableau d'entrées trouvées.
 */
async function searchLDAP(client, baseDN, searchOptions) {
    try {
        const rawResults = await rawSearchLDAP(client, baseDN, searchOptions); // Utilisez await ici

        return rawResults.map(entry => {
            const attributes = entry.attributes.reduce((acc, attr) => {
                acc[attr.type] = attr.values;
                return acc;
            }, {});
            attributes.dn = entry.objectName; // Ajouter le DN à l'objet d'attributs  
            return attributes; // Retourner l'objet d'attributs formaté  
        });
    } catch(err) {
        throw new Error(`Erreur de recherche: ${err.message}`); // Laissez l'erreur remonter  
    }
}

async function rawSearchLDAP(client, baseDN, searchOptions) {
    return new Promise((resolve, reject) => {
        const results = [];
        client.search(baseDN, searchOptions, (err, search) => {
            if (err) {
                return reject(new Error(`Erreur de recherche: ${err.message}`));
            }

            search.on('searchEntry', (entry) => {
                results.push(entry.pojo); // Ajoute l'entrée à la liste des résultats
            });

            search.on('end', (result) => {
                if (result.status !== 0) {
                    return reject(new Error(`Erreur lors de la recherche: Status ${result.status}`));
                }
                resolve(results); // Résoudre avec les résultats accumulés
            });

            search.on('error', (err) => {
                return reject(new Error(`Erreur de recherche: ${err.message}`));
            });
        });
    });
}

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
const getObjectClasses = async (config, objectClassesNameList) => {
    const schemaClient = ldap.createClient({ url: config.ldap.url }); // Créer un client pour interroger le schéma

    try {
        // Effectuer le bind avec le DN et le mot de passe pour le client du schéma  
        await bindClient(schemaClient, config.ldap.schema.bindDN, config.ldap.schema.bindPassword);

        if (objectClassesNameList.length === 0) {
	    throw new Error(`Objet non trouvé`); // Lancer une erreur vers le catch
        }

        const objectClassesDetails = []; // Tableau pour stocker les résultats

        // Utilisation de map pour lancer des recherches asynchrones pour chaque objectClass  
        const searchPromises = objectClassesNameList.map(async objectClass => {
            if (objectClass === 'top') {
                return; // Ignorer 'top'
            }

            const options = {
                filter: `(olcObjectClasses=* NAME '${objectClass}' *)`,
                scope: 'sub',
                attributes: ['olcObjectClasses']
            };

	    try {
                // Appel à searchLDAP pour effectuer la recherche  
                const searchResults = await rawSearchLDAP(schemaClient, config.ldap.schema.baseDN, options);
    
	        // Pas besoin de reduce ici, on peut directement traiter les résultats  
                const matchedAttributes = searchResults.filter(entry => 
                    entry.attributes.some(attr => attr.type === 'olcObjectClasses' && attr.values.some(value => value.includes(`NAME '${objectClass}'`)))
                );
    
                if (matchedAttributes.length > 0) {
                    const olcObjectClasses = matchedAttributes[0].attributes.find(attr => attr.type === 'olcObjectClasses').values[0];
                    const mustMatch = olcObjectClasses.match(/MUST\s*\(\s*([^)]*)\s*\)/);
                    const mayMatch = olcObjectClasses.match(/MAY\s*\(\s*([^)]*)\s*\)/);
    
                    // Nettoyer et formater les résultats  
                    const mustAttributes = mustMatch ? mustMatch[1].split('$').map(attr => attr.trim()).filter(Boolean) : [];
                    const mayAttributes = mayMatch ? mayMatch[1].split('$').map(attr => attr.trim()).filter(Boolean) : [];
                    
                    objectClassesDetails.push({ objectClassName: objectClass, attributes: { MUST: mustAttributes, MAY: mayAttributes } });
                }
            } catch (err) {
                console.error(`Erreur de recherche pour ${objectClass}:`, err);
                throw new Error(`Erreur lors de la récupération des attributs pour l'objectClass: ${objectClass}`); // Relancer l'erreur  
            }
        });
    
	// Attendre la résolution de toutes les promesses de recherche  
	await Promise.all(searchPromises);
    
	return objectClassesDetails; // Retourner le tableau des résultats  
    
    } catch (error) {
        console.error('Erreur de recherche pour', err);
	throw error; // Relancer l'erreur pour que l'appelant puisse la gérer 
    } finally {
	schemaClient.unbind(); // Fermer la connexion au client du schéma, même en cas d'erreur  
    }
};


module.exports = {
    bindClient,
    searchLDAP,
    rawSearchLDAP,
    getUserRoleFromDatabase,
    getObjectClasses,
    enrichObjectClassesDetails,
    updateAttributeConfigInLDAP
};
