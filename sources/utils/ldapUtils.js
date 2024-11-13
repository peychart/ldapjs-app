const ldap = require('ldapjs');
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

/*
 * Génération du LDIF de mise à jour de la base LDAP
 */
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
						type: key,
						values: [oldObject[key]]
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
							type: key,
							values: Array.isArray(newValue) ? newValue : [newValue]
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
			&& !(Array.isArray(newObject[key]) && (newObject[key].length === 0 || newObject[key][0] === ''))
			&& !isEmptyObject(newObject[key])
			) {
			// Si la clé est dans le nouvel objet mais pas dans l'ancien, c'est un ajout
			changes.push({
				operation: 'add',
				modification: {
					 type: key,
					 values: Array.isArray(newObject[key]) ? newObject[key] : [newObject[key]]
				}
			});
		}
	});

	// Convertir les changements en format compatible pour client.modify
	return { dn, changes };
}

/*
 * Mise a jour d'un dn LDAP
 */
async function updateLDAP(client, dn, newObject) {
	// Validation des paramètres
	if (!client || !dn || !newObject) {
		throw new Error('Client, DN, et nouvel objet sont requis.');
	}

	try {
		const oldObject = await searchLDAP(client, dn, {'scope': 'base', 'attributes': '*'});

		if (!oldObject || oldObject.length === 0) {
			throw new Error(`Aucun objet trouvé pour DN: ${dn}`);
		}

		// Génération du LDIF des changements
		const { changes } = generateLDIF(oldObject[0] || null, newObject, dn);

//console.clear();	//pour debug
//console.log('oldObject:', oldObject);	//pour debug
//console.log('\n\nnewObject:', newObject);	//pour debug
//console.log('\n\nChanges to be submitted:', JSON.stringify(changes, null, 2));	//pour debug
//return true; // pour debug

		// Exécution d'une seule requête pour toutes les modifications
		if (changes.length) await new Promise((resolve, reject) => {
			client.modify(dn, changes, (err) => {
				if (err) {
						console.error(`Erreur lors de l'application des changements :`, err);
						reject(err); // Rejeter la promesse en cas d'erreur
				} else {
						resolve(); // Résoudre la promesse si la modification réussit
				}
			});
		});

		return true;
	} catch(err) {
		console.error(`Erreur dans de mise à jour de la base LDAP : ${err.message}`);
		throw err; // Relance de l'erreur pour propagation
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
async function updateAttributeConfigInLDAP(client, config, attrName, attrConf) {
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
			entry.ou = !attrConf.MULTIVALUE ?'SINGLE-VALUE' :'MULTI-VALUE';
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

		if (Object.entries(entry).length > 2) {
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

/*
 * Parse de la défiition d'attribut extraite du schema de la base
 */
async function attributeTypeDefToJson(attributeDef) {
	return new Promise((resolve, reject) => {
		// Vérifier que l'input est une chaîne de caractères
		if (typeof attributeDef !== 'string') {
			return reject(new Error("attributeDef doit être une chaîne de caractères."));
		}

		const cleanedInput = attributeDef.trim();
        //const oidRegex = /\(\s*([\d.]+)\s/;
		const oidRegex = /\(\s*([\d.]+|[A-Za-z]+:[\d.]+)\s+/; // Support pour OID ou OLcfg
		const nameRegex = /\sNAME\s+\(\s*('(?:\w+)'(?:\s+'(?:\w+)')*)?\s*\)|\sNAME\s+('\w+')\s/;
		const descRegex = /DESC\s+'([^']+)'/;
		const equalityRegex = /EQUALITY\s+([^ ]+)/;
		const orderingRegex = /ORDERING\s+([^ ]+)/;
		const syntaxRegex = /SYNTAX\s+([^ ]+)/;
		const singleValueRegex = /SINGLE-VALUE/;
		const noUserModificationRegex = /NO-USER-MODIFICATION/;
		const usageRegex = /USAGE\s+([^ ]+)/;
		const xOrderedRegex = /X-ORDERED\s+([^\s]+)/; // Support pour X-ORDERED
		const supRegex = /SUP\s+([^ ]+)/; // Support pour SUP

		// Extraction des valeurs
		const oid = cleanedInput.match(oidRegex)?.[1] || null;
        const nameMatch = cleanedInput.match(nameRegex);
		const names = nameMatch ? (nameMatch[1] || nameMatch[2]).match(/'([^']+)'/g).map(name => name.replace(/'/g, '').trim()) : [];
		const desc = cleanedInput.match(descRegex)?.[1] || null;
		const equality = cleanedInput.match(equalityRegex)?.[1] || null;
		const ordering = cleanedInput.match(orderingRegex)?.[1] || null;
		const syntax = cleanedInput.match(syntaxRegex)?.[1] || null;
		const isSingleValue = singleValueRegex.test(cleanedInput);
		const isNoUserModification = noUserModificationRegex.test(cleanedInput);
		const usage = cleanedInput.match(usageRegex)?.[1] || null;
		const xOrdered = cleanedInput.match(xOrderedRegex)?.[1] || null;
		const sup = cleanedInput.match(supRegex)?.[1] || null; // Extraction de SUP

		// Créer l'objet JSON
		const attributeType = {
				OID: oid,
				NAME: names,
				...(desc && { DESC: desc }),
				...(equality && { EQUALITY: equality }),
				...(ordering && { ORDERING: ordering }),
				...(syntax && { SYNTAX: syntax }),
				...(isSingleValue && { SINGLE_VALUE: isSingleValue }),
				...(isNoUserModification && { NO_USER_MODIFICATION: isNoUserModification }),
				...(usage && { USAGE: usage, }),
				...(xOrdered && { X_ORDERED: xOrdered }),
				...(sup && { SUP: sup })
		};

		// Résoudre la promesse avec l'objet d'attribut
		resolve(attributeType);
	 });
}

const getOlcAttributeTypes = async (schemaClient, config, attributeName) => {
	 try {
		if (!attributeName || attributeName.length === 0) {
				throw new Error(`Nom d'attribut non fourni`);
		}

		// Options de recherche ajustées pour récupérer les définitions d'attributs
		const options = {
				filter: `(olcAttributeTypes=*NAME*'${attributeName}'*)`, // Obtenez toutes les définitions d'attributs
				scope: 'sub',
				attributes: ['olcAttributeTypes']
		};

		const result = await searchLDAP(schemaClient, config.ldap.schema.baseDN, options);

		if (!result || result.length === 0 || !result[0].olcAttributeTypes) {
			throw new Error(`Aucun attribut ou olcAttributeTypes trouvé pour: '${attributeName}'`);
		}

		const olcAttributeTypes = result[0].olcAttributeTypes;

		if (!Array.isArray(olcAttributeTypes) || olcAttributeTypes.length === 0) {
			throw new Error(`La propriété 'olcAttributeTypes' n'est pas un tableau ou est vide.`);
		}

		// Rechercher la définition d'attribut spécifique avec un regex plus précis
		const regexCase1 = new RegExp(`NAME\\s*\\(\\s*(?:['"]?[^'"]*['"]?\\s+)*['"]?${attributeName}['"]?(?:\\s+['"]?[^'"]*['"]?)*\\)`, 'i'); // Cas où attributeName est dans une liste 
		const regexCase2 = new RegExp(`NAME\\s*['"]?${attributeName}['"]?`, 'i'); // Cas où attributeName est seul
		const regexCase3 = new RegExp(`NAME\\s*\\(\\s*['"]?${attributeName}['"]?\\s*\\)`, 'i'); // Cas où attributeName est le seul dans les parenthèses
		const attributeTypeDef = olcAttributeTypes.find(str => {
			 return regexCase1.test(str) || regexCase2.test(str) || regexCase3.test(str);
		});

		if (!attributeTypeDef) {
			throw new Error(`Aucune définition trouvée pour l'attribut: '${attributeName}'`);
		}

		// JSON parse
		const attributeType = await attributeTypeDefToJson(attributeTypeDef);

		return attributeType;
	 } catch (error) {
		console.error('Erreur de recherche pour', attributeName, ':', error);
		throw error;
	 }
};

/**
 * Parse de la définition text d'un objectClass en object JS
 */
async function objectClassDefToJson(inputString) {
    return new Promise((resolve, reject) => {
        // Vérification du type d'entrée  
        if (typeof inputString !== 'string') {
            reject(new Error("inputString doit être une chaîne de caractères."));
            return;
        }

        const cleanedInput = inputString.trim();
//console.log('\ncleanedInput: ', cleanedInput);
        
        // Définitions des expressions régulières  
		//const oidRegex = /\(\s*([\d.]+|[A-Za-z]+:[\d.]+)\s+/; // Support pour OID ou OLcfg
        const oidRegex = /\(\s*([\d.]+)\s/;
		const nameRegex = /\sNAME\s+\(\s*('(?:\w+)'(?:\s+'(?:\w+)')*)?\s*\)|\sNAME\s+('\w+')\s/;
        const descRegex = /DESC\s+'([^']+)'/;
        const supRegex = /SUP\s+([^ ]+)/;
        const auxiliaryRegex = /AUXILIARY/;
        const structuralRegex = /STRUCTURAL/;
        const abstractRegex = /ABSTRACT/;

        // Extraction des valeurs  
        const oid = cleanedInput.match(oidRegex)?.[1] || null;
        const nameMatch = cleanedInput.match(nameRegex);
		const names = nameMatch ? (nameMatch[1] || nameMatch[2]).match(/'([^']+)'/g).map(name => name.replace(/'/g, '').trim()) : [];

        const desc = cleanedInput.match(descRegex)?.[1] || null;
        const supMatches = cleanedInput.match(supRegex);
        const sup = supMatches ? supMatches[1] : null;
        const isAuxiliary = auxiliaryRegex.test(cleanedInput);
        const isStructural = structuralRegex.test(cleanedInput);
        const isAbstract = abstractRegex.test(cleanedInput);

        const mustRegex = /MUST\s+\((.*?)\)|MUST\s+(\w+)/;
        const mustMatch = cleanedInput.match(mustRegex);
        const must = mustMatch ? (mustMatch[1] || mustMatch[2]) : null;
        const mustAttributes = must ?Object.fromEntries(must.replace(/\$/g, '').trim().split(/\s+/).map(attr => [attr, null])) :{};

        const mayRegex = /MAY\s+\((.*?)\)|MAY\s+(\w+)/;
        const mayMatch = cleanedInput.match(mayRegex);
        const may = mayMatch ? (mayMatch[1] || mayMatch[2]) : null;
        const mayAttributes = may ?Object.fromEntries(may.replace(/\$/g, '').trim().split(/\s+/).map(attr => [attr, null])) :{};

        // Construction de l'objet final  
        const objectClass = {
            OID: oid,
            NAME: names,
            ...(desc && { DESC: desc }),
            SUP: sup,
            ...(isStructural && { STRUCTURAL: isStructural }),
            ...(isAuxiliary && { AUXILIARY: isAuxiliary }),
            ...(isAbstract && { ABSTRACT: isAbstract }),
            MUST: mustAttributes,
            MAY: mayAttributes  
        };

        resolve(objectClass);
    });
}


/*
 * Recherche les objectClasses selon filter
 */
async function getAllObjectClasses(schemaClient, config, filter) {
	try {
		// Définir les options pour la recherche dans le schéma LDAP
		const options = {
			filter: '(olcObjectClasses=*)',		// Cherche toutes les définitions d'objectClasses
			scope: 'sub',						// Définit la profondeur de la recherche
			attributes: ['olcObjectClasses']	// Attributs à récupérer
		};

		// Effectuer la recherche LDAP pour récupérer toutes les définitions d'objectClasses
		const searchResult = await searchLDAP(schemaClient, config.ldap.schema.baseDN, options);

		const results = [];

		// Créer un tableau de promesses pour toutes les opérations asynchrones  
		const promises = searchResult.map(async (entry) => {
			return Promise.all(entry.olcObjectClasses.map(async (objectClassDefinition) => {
				// Vérifier si le filtre est fourni et tester si la définition correspond  
				if (filter && !new RegExp(filter).test(objectClassDefinition)) {
					return; // Ne pas inclure cette définition si elle ne correspond pas  
				}

				// Convertir la définition en objet avec la fonction objectClassDefToJson  
				const objectClass = await objectClassDefToJson(objectClassDefinition);

				// Enrichir l'objet class avec les détails des attributs  
				await enrichObjectClassWithAttributeDetails(schemaClient, config, objectClass);

				// Ajouter l'objet class à la liste des résultats  
				if (objectClass.OID)	// Filtrer les 'OLcfgGlAt'
					results.push(objectClass);
			}));
		});

		// Attendre que toutes les promesses soient résolues
		await Promise.all(promises);

		return results; // Retourner le tableau des objets objectClass
	} catch (error) {
		console.error('Erreur lors de l\'extraction des classes d\'objet :', error);
		throw error; // Laisser l'erreur remonter
	}
}

/*
 * Recherche les objectClass STRUCTURAL, AUXILIARY ou ABSTRACT, ... ou tout autre filtre
 */
async function getObjectClassesByType(schemaClient, config, CLASSTYPE) {
	try {
		if (!CLASSTYPE) {
			throw new Error(`Type de classe non spécifié`);
		}

		// Filtre de recherche des classes d'objet par type  
		const filter = `\\s+${CLASSTYPE}\\s*`;

		// Récupérer toutes les classes d'objet qui correspondent au type  
		return await getAllObjectClasses(schemaClient, config, filter);
	} catch (error) {
		console.error('Erreur lors de l\'extraction des classes d\'objet par type :', error);
		throw error; // Laisser l'erreur remonter  
	}
}

/**
 * Récupération de la dénition complète d'un objectClass dans le schema de la base
 */
const getObjectClass = async (schemaClient, config, objectClassName) => {
	try {
		if (!objectClassName) {
			throw new Error(`ObjetClass non spécifié`);
		}

		// Filtre de recherche d'une classe d'objet par son nom
		const filter = `\\s*NAME\\s+'${objectClassName}'\\s+`;

		const objectClasses = await getAllObjectClasses(schemaClient, config, filter);

		if (objectClasses.length === 0) {
			throw new Error(`Classe non trouvée`);
		}

		return objectClasses[0];
	} catch (error) {
		console.error('Erreur de recherche pour la classe ', objectClassName, ':', error);
		throw error;
	}
};

/*
 * Recherche dans le schema des définitions d'attributs et mise à jour dans l'objectClass
 */
const enrichObjectClassWithAttributeDetails = async (schemaClient, config, objectClass) => {
	 try {
		// Vérification que l'objectClass est fourni
		if (!objectClass) {
			throw new Error("Aucune définition d'objectClass fournie.");
		}


		// Pour chaque attribut, obtenir sa définition
		await Promise.all(
			['MUST', 'MAY'].flatMap(key => {
				Object.keys(objectClass[key]).map(async (attribute) => {
					try {
						if (!objectClass[key][attribute]) {
							const attributeDetails = await getOlcAttributeTypes(schemaClient, config, attribute);
							// Enrichir directement l'objectClass
							objectClass[key][attribute] = attributeDetails;
						}
					} catch (error) {
						console.error(`Erreur lors de la récupération des détails pour l'attribut ${attribute}:`, error);
						// Lancer une erreur au lieu de stocker un message d'erreur
						throw new Error(`Erreur lors de la récupération des détails pour l'attribut ${attribute}: ${error.message}`);
					}
				});
			})
		);

		// A ce stade, objectClass a été modifié en place avec les attributs enrichis
		return objectClass; // Retourner l'objet modifié

	 } catch (error) {
		console.error('Erreur lors de la récupération des détails de l\'objectClass enrichie:', error);
		throw error; // Relancer l'erreur pour que l'appelant puisse la gérer
	 }
};

/*
 * Ajouter tous les attributs MUST hérités
 */
const getInheritedMustAttributes = async (schemaClient, config, objectClass) => {
	if (!objectClass || typeof objectClass !== 'object') {
		throw new Error('Invalid objectClass provided');
	}

	const getInheritedMustAttributesFromSuperClasses = async (cls) => {
		let results = { ...cls.MUST }; // Initialiser avec les attributs MUST actuels
		if (cls.SUP && cls.SUP !== 'top') {
			const supClass = await getObjectClass(schemaClient, config, cls.SUP).catch(() => null);
			if (supClass) {
				const supMustAttributes = await getInheritedMustAttributesFromSuperClasses(supClass);
				results = { ...results, ...supMustAttributes }; // Fusionner les attributs
			}
		}
		return results;
	};

	objectClass.MUST = await getInheritedMustAttributesFromSuperClasses(objectClass);

	// Ajout des définitions d'attributs
	return await enrichObjectClassWithAttributeDetails(schemaClient, config, objectClass);
};

module.exports = {
	bindClient,
	searchLDAP,
	rawSearchLDAP,
	getUserRoleFromDatabase,
	getObjectClass,
	getInheritedMustAttributes,
	getObjectClassesByType,
	updateLDAP,
	updateAttributeConfigInLDAP
};
