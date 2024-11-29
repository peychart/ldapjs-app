/*  LDAP-editor (Version 0.1 - 2022/06)
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
		if (oldObject.hasOwnProperty(key) && key !== 'dn') {
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
		// Filtrer les valeurs null des tableaux
		if (Array.isArray(newObject[key]))
			newObject[key] = newObject[key].filter(value => value !== null);

		if (newObject.hasOwnProperty(key)
			&& (!oldObject || !oldObject.hasOwnProperty(key))
			&& newObject[key] !== null
			&& newObject[key] !== undefined
			&& newObject[key] !== ''
			&& !(Array.isArray(newObject[key]) && (newObject[key].length === 0 || newObject[key][0]))
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

function ldapValidate(object) {
	const errors = []; // Stocke les messages d'erreur

//errors.push('(ceci est un break de debug ...)');
	return errors.length > 0 ? errors : null; // Retourne les erreurs, sinon null
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
		const validationErrors = ldapValidate(newObject);
		if (validationErrors) {
			const error = new Error('Erreur de format LDAP : ' + validationErrors.join(', '));
			error.code = 255;
			throw error;
		}

		const oldObject = await searchLDAP(client, dn, {'scope': 'base', 'attributes': '*'});

		if (!oldObject || oldObject.length === 0) {
			throw new Error(`Aucun objet trouvé pour DN: ${dn}`);
		}

//console.log('oldObject:', oldObject);	//pour debug
//console.log('\n\nnewObject:', newObject);	//pour debug

		// Génération du LDIF des changements
		const { changes } = generateLDIF(oldObject[0] || null, newObject, dn);

//console.log('\n\nChanges to be submitted:', JSON.stringify(changes, null, 2));	//pour debug

		// Exécution d'une seule requête pour toutes les modifications
		if (changes.length) await new Promise((resolve, reject) => {
			client.modify(dn, changes, (err) => {
				if (err) {
						console.error(`écriture base echouée:`, err);
						reject(err); // Rejeter la promesse en cas d'erreur
				} else {
						resolve(); // Résoudre la promesse si la modification réussit
				}
			});
		});

		return true;
	} catch(err) {
		if (err >= 250)
			throw err;
		else {
			console.error(`Une erreur est survenue: ${err.message}`);
			throw err; // Relance de l'erreur pour propagation
		}
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
		const entry = {
			objectClass: ['top', 'applicationProcess'],
			cn: attrName,
			...(attrConf.customWording && { l: attrConf.customWording }),
			...(attrConf.MULTIVALUE != null && { ou: !attrConf.MULTIVALUE ? 'SINGLE-VALUE' : 'MULTI-VALUE' }),
			...(attrConf.valueCheck && { description: attrConf.valueCheck })
		};
//console.log('entry: ', JSON.stringify(entry, null, 2)); // Pour debug

		// Remove de l'entrée existante
		const dnExists = await checkDNExists(client, dn);
		if (dnExists) {
			// Si l'entrée existe, la supprimer
			await new Promise((resolve, reject) => {
				client.del(dn, (err) => {
					if (err)
						return reject(err);
					resolve();
				});
			});
		}

		if (Object.entries(entry).length > 2) {
			// Ajouter la nouvelle entrée de custom attribut
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
		//const oidRegex = /\(\s*([\d.]+|[A-Za-z]+:[\d.]+)\s+/; // Support pour OID ou OLcfg
		const oidRegex = /\(\s*([\d.]+)\s/;
		const nameRegex = /\sNAME\s+\(\s*('(?:[\w-]+)'(?:\s+'(?:[\w-]+)')*)?\s*\)|\sNAME\s+('[\w-]+')/;
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
		const nameRegex = /\sNAME\s+\(\s*('(?:[\w-]+)'(?:\s+'(?:[\w-]+)')*)?\s*\)|\sNAME\s+('[\w-]+')/;
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

		const type = isStructural ?'STRUCTURAL' :isAuxiliary ?'AUXILIARY' :isAbstract ?'ABSTRACT' :'';

		const mustRegex = /MUST\s+\((.*?)\)|MUST\s+([\w-]+)/;
		const mustMatch = cleanedInput.match(mustRegex);
		const must = mustMatch ? (mustMatch[1] || mustMatch[2]) : null;
		//const mustAttributes = must ?Object.fromEntries(must.replace(/\$/g, '').trim().split(/\s+/).map(attr => [attr, null])) :{};
		const mustAttributes = must ? must.replace(/\$/g, '').trim().split(/\s+/) : [];

		const mayRegex = /MAY\s+\((.*?)\)|MAY\s+([\w-]+)/;
		const mayMatch = cleanedInput.match(mayRegex);
		const may = mayMatch ? (mayMatch[1] || mayMatch[2]) : null;
		//const mayAttributes = may ?Object.fromEntries(may.replace(/\$/g, '').trim().split(/\s+/).map(attr => [attr, null])) :{};
		const mayAttributes = may ? may.replace(/\$/g, '').trim().split(/\s+/) : [];

		// Construction de l'objet final
		const objectClass = {
			OID: oid,
			NAME: names,
			...(desc && { DESC: desc }),
			SUP: sup,
			TYPE: type,
			MUST: mustAttributes,
			MAY: mayAttributes
		};

		resolve(objectClass);
	});
}

/*
 * Recherche les objectClasses selon filter
 */
async function loadSchema(ldap, config) {
	const schemaClient = ldap.createClient({ url: `${config.ldap.url}:${config.ldap.port}` });

	try {
		// Liaison au client LDAP
		await bindClient(schemaClient, config.ldap.schema.bindDN, config.ldap.schema.bindPassword);
		
		// Définir les options pour la recherche dans le schéma LDAP
		const options = {
//			filter: '(olcObjectClasses=*)',		// Cherche toutes les définitions d'objectClasses
			scope: 'sub',						// Définit la profondeur de la recherche
			attributes: ['olcObjectClasses', 'olcAttributeTypes']	// Attributs à récupérer
		};

		const searchResult = await searchLDAP(schemaClient, config.ldap.schema.baseDN, options);

		let result = {
			attributes: [],
			objectClasses: []
		};

		for (const schema of searchResult) {
			if (schema.olcAttributeTypes) {
				const attributePromises = schema.olcAttributeTypes.map(async (entry) => {
					try {
						const a = await attributeTypeDefToJson(entry);
						if (a.OID)						// Filtrer les 'OLcfgGlAt'
							return a;
					} catch (error) {
						console.error(`Erreur lors de la conversion de l'attribut : ${error}`);
					}
				});

				const attributes = await Promise.all(attributePromises);
				result.attributes.push(...attributes.filter(Boolean));
			}

			if (schema.olcObjectClasses) {
				const objectClassPromises = schema.olcObjectClasses.map(async (entry) => {
					try {
						const o = await objectClassDefToJson(entry);
						if (o.OID)						// Filtrer les 'OLcfgDbOc'
							return o;
					} catch (error) {
						console.error(`Erreur lors de la conversion de la classe d'objet : ${error}`);
					}
				});

				const objectClasses = await Promise.all(objectClassPromises);
				result.objectClasses.push(...objectClasses.filter(Boolean));
			}
		}

		return result; // Retournez le bon résultat

	} catch (error) {
		console.error('Erreur lors de l\'extraction du schema :', error);
		throw error; // Laisser l'erreur remonter
	} finally {
		// Déconnexion du schemaClient
		try {
			await schemaClient.unbind();
		} catch (unbindError) {
			console.error('Erreur lors de la déconnexion du schemaClient:', unbindError);
		}
	}
}

/*
 * Recherche les objectClass STRUCTURAL, AUXILIARY ou ABSTRACT, ... ou tout autre filtre
 */
function getObjectClassesByType(ldapSchema, type) {
	if (typeof type !== 'string') {
		throw new Error("type doit être une chaîne de caractères.");
	}
	return ldapSchema.filter(objectClass => objectClass.TYPE === type);
}

/**
 * Récupération de la définition complète d'un objectClass dans le schema de la base
 */
function getObjectClassByName(ldapSchema, name) {
	const objectClass = ldapSchema.objectClasses.find(schema => schema.NAME.includes(name));
	return objectClass ? objectClass : null;
}

/*
 * Ajouter tous les attributs MUST hérités
 */
function setInheritedMustAttributes(ldapSchema, objectClass) {
	if (!objectClass || typeof objectClass !== 'object') {
		throw new Error('Invalid objectClass provided');
	}

	const setInheritedMustAttributesFromSuperClasses = (cls) => {
		 let results = [...(cls.MUST || [])]; // Initialiser avec les attributs MUST actuels sous forme de tableau

		if (cls.SUP && cls.SUP !== 'top') {
			const supClass = getObjectClassByName(ldapSchema, cls.SUP);
			if (supClass) {
				const supMustAttributes = setInheritedMustAttributesFromSuperClasses(supClass);
				results = Array.from(new Set([...results, ...supMustAttributes]));
			}
		}
		return results; // Retourner le tableau des attributs MUST  
	};

	return {
		...objectClass,
		MUST: setInheritedMustAttributesFromSuperClasses(objectClass)
	};
}

/*
 * Recherche dans le schema des définitions d'attributs et mise à jour dans l'objectClass
 */
function enrichObjectClassWithAttributes(ldapSchema, objectClass) {
	 try {
		// Vérification que l'objectClass est fourni
		if (!objectClass) {
			throw new Error("Aucune définition d'objectClass fournie.");
		}

		// Pour chaque attribut, obtenir sa définition
		['MUST', 'MAY'].forEach(key => {
				const enrichedAttributes = objectClass[key].map(attribute => {
                    const attributeDetails = ldapSchema.attributes.find(attr =>
                        attr.NAME.some(name => name.toLowerCase() === attribute.toLowerCase())
                    );

				if (attributeDetails)
						return { ...attributeDetails };	// Cloner l'objet d'attribut 
				else	throw new Error(`Pas de définition d'attribut correcte dans le schema pour "${attribute}".`);
			});

			// Remplacer le tableau d'attributs par le tableau enrichi  
			objectClass[key] = enrichedAttributes;
		});

		// A ce stade, objectClass a été modifié en place avec les attributs enrichis
		return objectClass; // Retourner l'objet modifié

	} catch (error) {
		console.error('Erreur lors de la récupération des détails de l\'objectClass à enrichir:', error);
		throw error; // Relancer l'erreur pour que l'appelant puisse la gérer
	}
}

module.exports = {
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
};
