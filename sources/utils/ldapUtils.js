const ldap = require('ldapjs');
const config = require('../config.json'); // Assurez-vous d'importer votre fichier de configuration
const {
	isEqual
} = require('../utils/utils');


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
		throw new Error(err.message); // Laissez l'erreur remonter
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

function generateLDIF(oldObject, newObject, dn) {
	const changes = [];

	// Parcourir les propriétés de l'ancien objet  
	if (oldObject !== null && typeof oldObject === 'object') Object.keys(oldObject).forEach(key => {
		if (oldObject.hasOwnProperty(key) && key !== 'dn' && key !== 'objectClass') {
			if (!newObject || !newObject.hasOwnProperty(key)) {
				// Si la clé n'est pas dans le nouvel objet, elle a été supprimée  
				changes.push({
					operation: 'delete',
					modification: {
						[key]: oldObject[key]
					}
				});
			} else {
				const newValue = newObject[key];
				const oldValue = Array.isArray(newValue) 
                        ? (Array.isArray(oldObject[key]) ? oldObject[key] : [oldObject[key]]) 
                        : (Array.isArray(oldObject[key]) ? oldObject[key][0] : oldObject[key]);

				if (!isEqual(oldValue, newValue)) {
					// Si la clé existe dans les deux objets mais avec des valeurs différentes  
					changes.push({
						operation: 'replace',
						modification: {
							[key]: newObject[key]
						}
					});
				}
			}
		}
	});

	// Parcourir les propriétés du nouvel objet pour trouver les ajouts  
	if (newObject !== null && typeof newObject === 'object') Object.keys(newObject).forEach(key => {
		if (newObject.hasOwnProperty(key)
			&& (!oldObject || !oldObject.hasOwnProperty(key))
			&& newObject[key] !== null
			&& newObject[key] !== undefined
			&& newObject[key] !== ''
			&& !(Array.isArray(newObject[key]) && newObject[key].length === 0)
			&& !isEmptyObject(newObject[key])
			) {
			// Si la clé est dans le nouvel objet mais pas dans l'ancien, c'est un ajout  
			changes.push({
				operation: 'add',
				modification: {
					[key]: newObject[key]
				}
			});
		}
	});

	// Convertir les changements en format compatible pour client.modify  
	return { dn, changes: changes };
}

// Mise a jour d'un dn LDAP
async function updateLDAP(client, dn, newObject) {
	try {
		const oldObject = await searchLDAP(client, dn, {'scope': 'base', 'attributes': '*'});
		const { changes } = generateLDIF(oldObject[0] || null, newObject, dn);

console.log('oldObject:', oldObject);	//pour debug
console.log('\n\nnewObject:', newObject);	//pour debug
console.log('\n\nChanges to be submitted:', changes);	//pour debug
return true; // pour debug

		const promises = changes.map(change => {
			return new Promise((resolve, reject) => {
				changes.forEach(change => {
					client.modify(dn, change, (err) => {
						if (err) {
							console.error(`Erreur lors de la modification ${change.operation} :`, err);
							reject(err); // Rejeter la promesse en cas d'erreur  
						} else {
							resolve(); // Résoudre la promesse si la modification réussit  
						}
					});
				});
			});
		});

		// Attendre que toutes les modifications soient terminées
		await Promise.all(promises);
		return true;
	} catch(err) {
		console.error(`Erreur dans de mise à jour de la base LDAP : ${err.message}`);
		throw err; // Relance de l'erreur
	}
}

/**
 * Vérifie l'existence de la branche racine dans LDAP et la créer si elle n'existe pas.
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

// Fonction auxiliaire pour créer la branche racine conf des attributs
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
		if (attrConf.MULTIVALUE != null) {
			entry.ou = attrConf.MULTIVALUE ?'MULTI-VALUE' :'SINGLE-VALUE'; 
		}
		if (attrConf.valueCheck) {
			entry.description = attrConf.valueCheck; 
		}
//console.log('entry: ', JSON.stringify(entry)); // Pour debug

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

		if (Object.entries(entry).length > 0) {
			// Ajouter la nouvelle entrée d'attribut
			await new Promise((resolve, reject) => {
				client.add(dn, entry, (err) => {
					if (err) {
						return reject(err);
					}
					resolve();
				});
			});
		}

		return true;

	} catch (error) {
		throw new Error(`Erreur dans la mise à jour des paramètres d'attribut: ${error.message}`);
	}
}

/**
 * Fonction pour convertir la définition text d'un objectClass en object JS
 */
async function objectClassDefToJson(inputString) {
	return new Promise((resolve, reject) => {
		if (typeof inputString !== 'string') {
			reject(new Error("inputString doit être une chaîne de caractères."));
			return;
		}

		const cleanedInput = inputString.replace(/^.*?(\(\s*[\d.]+.*)/, '$1').trim();

		const oidRegex = /\(\s*([\d.]+)/;
		const nameRegex = /NAME\s+'([^']+)'/;
		const descRegex = /DESC '([^']+)'/;
		const supRegex = /SUP\s+([^ ]+)/;
		const auxiliaryRegex = /AUXILIARY/;
		const structuralRegex = /STRUCTURAL/;
		const abstractRegex = /ABSTRACT/;
		const mustRegex = /MUST \((.*?)\)/;
		const mayRegex = /MAY \((.*?)\)/;

		const oid = cleanedInput.match(oidRegex)?.[1] || null;
		const nameMatches = cleanedInput.match(nameRegex);
		const name = nameMatches ? nameMatches[1] : null;
		const desc = cleanedInput.match(descRegex)?.[1] || null;
		const supMatches = cleanedInput.match(supRegex);
		const sup = supMatches ? supMatches[1] : null;
		const isAuxiliary = auxiliaryRegex.test(cleanedInput);
		const isStructural = structuralRegex.test(cleanedInput);
		const isAbstract = abstractRegex.test(cleanedInput);
		const must = cleanedInput.match(mustRegex)?.[1] || null;
		const may = cleanedInput.match(mayRegex)?.[1] || null;

		const mustAttributes = must ? Object.fromEntries(must.split(' $ ').map(attr => [attr.trim(), null])) : {};
		const mayAttributes = may ? Object.fromEntries(may.split(' $ ').map(attr => [attr.trim(), null])) : {};

		const objectClass = {
			OID: oid,
			NAME: name,
			DESCRIPTION: desc,
			SUP: sup,
			AUXILIARY: isAuxiliary,
			STRUCTURAL: isStructural,
			ABSTRACT: isAbstract,
			MUST: mustAttributes,
			MAY: mayAttributes
		};

		resolve(objectClass);
	});
}

/**
 * Fonction pour récupérer les attributs MUST des objectClasses SUP
 */
const getAllMustAttributes = async (config, objectClass) => {
	// Vérifier que objectClass est valide
	if (!objectClass || typeof objectClass !== 'object') {
		console.error('Invalid objectClass provided');
		return {};
	}

	const supAttributes = {};

	try {
		// Vérifier si MUST est un objet et l'ajouter au supAttributes
		if (objectClass.MUST && typeof objectClass.MUST === 'object') {
			Object.keys(objectClass.MUST).forEach(attr => {
				supAttributes[attr] = objectClass.MUST[attr]; // Sauvegarder les détails de l'attribut
			});
		}

		if (!objectClass.SUP || objectClass.SUP === 'top') {
			return supAttributes;
		}

		// Récupérer la classe supérieure
		const supClass = await getObjectClass(config, objectClass.SUP).catch(() => (null));

		// Ajouter les attributs de MUST de la classe supérieure
		if (supClass) {
			const supSupAttributes = await getAllMustAttributes(config, supClass);
			// Fusionner les attributs retournés par la sous-classe
			Object.keys(supSupAttributes).forEach(attr => {
				supAttributes[attr] = supSupAttributes[attr]; // Sauvegarder les détails de l'attribut
			});
		}
	} catch (error) {
		console.error(`Erreur lors de la récupération des attributs de la super classe de ${JSON.stringify(objectClass)} :`, error);
	}

	return supAttributes; // Retourner l'objet contenant les attributs obligatoires
}

/**
 * Fonction pour récupérer les attributs de chaque objectClass dans le schéma
 */
const getObjectClass = async (config, objectClassName) => {
	// Créer un client pour interroger le schéma
	const schemaClient = ldap.createClient({ url: `${config.ldap.url}:${config.ldap.port}` });

	try {
		// Effectuer le bind avec le DN et le mot de passe d'accès au schéma LDAP
		await bindClient(schemaClient, config.ldap.schema.bindDN, config.ldap.schema.bindPassword);

		if (!objectClassName || objectClassName.length === 0) {
			throw new Error(`ObjetClass non trouvé`); // Lancer une erreur vers le catch
		}

		// Utilisation de map pour lancer des recherches asynchrones pour chaque objectClass
		const options = {
			filter: `(olcObjectClasses=* NAME '${objectClassName}' *)`,
			scope: 'sub',
			attributes: ['olcObjectClasses']
		};

		// Appel à searchLDAP pour effectuer la recherche
		const result = await searchLDAP(schemaClient, config.ldap.schema.baseDN, options)
			.catch(() => {
				throw new Error(`Aucune classe d'objet trouvée pour: '${objectClassName}'`)
			});

		// Convertir le résultat brut en JSON
		const objectClass = await objectClassDefToJson(result[0].olcObjectClasses.find(str => {
				const regex = new RegExp(`\\s*NAME\\s+'${objectClassName}'\\s+`);
				return regex.test(str);
			})
		);

	return objectClass; // Retourner l'objet résultat
	
	} catch (error) {
		console.error('Erreur de recherche pour', objectClassName, ':', error);
	throw error; // Relancer l'erreur pour que l'appelant puisse la gérer 
	} finally {
	schemaClient.unbind(); // Fermer la connexion au client du schéma, même en cas d'erreur
	}
};


module.exports = {
	bindClient,
	searchLDAP,
	updateLDAP,
	rawSearchLDAP,
	getUserRoleFromDatabase,
	getObjectClass,
	getAllMustAttributes,
	updateAttributeConfigInLDAP
};
