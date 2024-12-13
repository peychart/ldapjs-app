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
// Fonction pour charger et vérifier la config
const path = require('path');
const fs = require('fs');
const configPath = path.join(__dirname, '../config.json');
const defaultNodePort = 3000;
const defaultLdapPort = 3000;

const loadConfig = () => {
	let config = {};
	if (fs.existsSync(configPath)) {
		const data = fs.readFileSync(configPath);

		try {
			config = JSON.parse(data);
		} catch (err) {
			config = null;
	}	}

	if (config) {
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
			nodeJsPort: defaultNodePort,			// Port du serveur http nodeJs
			ldap: {
				url: "ldap://localhost",			// URL du serveur LDAP
				port: 389,							// URL du serveur LDAP
				data: {
					bindDN: "cn=admin," + baseDN,	// DN pour l'authentification
					bindPassword: "password",		// Mot de passe pour l'authentification 
					baseDN: baseDN					// DN de base pour les recherches
				},
				schema: {
					baseDN: "cn=schema",			// DN pour le schéma LDAP
					bindDN: "cn=admin," + baseDN,	// DN pour l'authentification au schéma
					bindPassword: "schemaPassword"	// Mot de passe pour l'authentification au schéma
				} 
			},
			configDn: {
				root: "ou=carnetLDAP,ou=application," + baseDN,
				attributs: "ou=attribut",
				searchProfiles: "ou=searchProfile"
			},
			logFile: "logs/application.log",
			sessionSecret: "secret_complexe"
		};
		// Sauvegarde des valeurs par défaut dans config.json
		fs.writeFileSync(configPath, JSON.stringify(defaultConfig, null, 2));
	}
	return config;
};

module.exports = {
	loadConfig
};
