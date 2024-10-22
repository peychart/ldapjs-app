# ldapjs-app
A web application for managing LDAP entries using ldapjs, allowing users to search, edit, and organize LDAP data effectively through an intuitive interface.



Une application nodeJS simple, utilisant la bibliothèque `ldapjs` pour interagir avec un serveur LDAP ; elle permet de rechercher, éditer et gérer des entrées d'une base LDAP via une simple interface web.

Ce projet dérive d'un autre vieux projet écrit en Qt et C++ d'une application client-serveur qui permettait de gérer différents aspects de l'administration d'un réseau d'entreprise : users, groups, dns, serveurs, ressources partagés, crons, firewals, ...

On peut le trouver ici : https://github.com/peychart/libldapcppei (archive zip : ldapEasyAdminFrontends-1.1.3.tgz), en exemple d'utilisation de la bibliothèque 'ldapcppei' qu'il utilise ; la documentation complète (français/anglais), au format http, se trouve dans le répertoire "webdoc" ...

Ce tout nouveau projet est lui, en quelque sorte, un début de ré-écrite en nodeJS, offrant ainsi un accès beaucoup plus immédiat puisqu'au format web ; mais les principes de fonctionnement restent similaires :

- la lecture du schéma de l'annuaire permet la constitution dynamique des masques de saisie des informations stockées dans la base,
- Le principe d'association 'onglet-objectClass' permet une vision claire des propriétés, facilitant les ajouts et retraits contrôlés des objectClass structurant chacune des entrées créées ou éditées,
- un principe de paramétrage de chacun des attributs (à personnaliser ici en JavaScript) permet de gérer à la fois les contraintes de saisie de chaque attribut d'annuaire mais, également, les contraintes d'intégrité qui peuvent exister entre les attributs eux-mêmes.


NOTICE : Cette ré-écriture n'est pas encore opérationnelle (exemple, la logique des classes n'est pas encore fixée) mais, dans son état actuel, elle peut déjà être testée permettant ainsi d'envisager les principes de l'interface visée.


## Table des matières

- [Fonctionnalités](#fonctionnalités)
- [Installation](#installation)
- [Configuration](#configuration)
- [Utilisation](#utilisation)
- [Fonctions Utilitaires de contrôle des saisies](#Fonctions-utilitaires-de-contrôle-des-saisies-dattributs)
- [Contribuer](#contribuer)
- [Licence](#licence)


## Fonctionnalités

- Connexion à un serveur LDAP,
- Recherche d'entrées LDAP par UID, CN, prénom, ou numéro d'employé (à terme, sera paramétrable au sein de l'interface),
- Édition des attributs des entrées LDAP,
- Gestion des formats et des contraintes d'intégrité entre champs de saisie,
- ajout d'objectClass aux entrées existantes et création de nouvelles entrées,
- importation de fichiers CSV pour création d'entrées en masse,
- etc.


#  Installation

Pour exécuter cette application, suivre ces étapes :

1. Cloner ce dépôt :

```
bash
git clone https://github.com/votre-utilisateur/ldapjs-app.git
cd ldapjs-app
```

2. Installer les dépendances :

```
bash npm install
```


## Configuration

Avant de démarrer l'application, il conviendra d'ajuster les informations du contexte LDAP :
* Renommer le fichier config.example.json en config.json,
* chmod 600 config.json,
* vérifier l'appartenance du fichier,
* Modifier le fichier config.json pour y inclure les informations propre à la base LDAP à éditer.

Un exemple de fichier config.json est présenté ici :

```
{
    "ldap": {
        "url": "ldap://localhost:389",
        "base": {
            "bindDN": "cn=admin,dc=example,dc=com",
            "bindPassword": "secret",
            "baseDN": "dc=example,dc=com"
        },
        "schema": {
            "baseDN": "cn=schema",
            "bindDN": "cn=admin,dc=example,dc=com",
            "bindPassword": "schemaPassword"
        }
    },
    "configDn": {
        "root": "ou=carnetLDAP,ou=applications,dc=example,dc=com",
        "attributs": "ou=attribut"
    }
}
```

Explications :
* l'entrée "ldap" définie l'accès à la base ; il doit être read/write,
* l'entrée "schema" définie l'accès à son schéma ; un readOnly est suffisant,
* l'entrée définie le lieu de stockage dans la base du paramétrage de l'application :
   * définitions associées aux attributs,
   * logique des classes (associations métiers, attributs de recherche, etc.)
   * ...


## Utilisation

Pour démarrer l'application, exécuter :

```
node app.js (ce démarrage pourra être plus tard configuré en service).
```

Ouvrir un navigateur et appeler le lien suivant : http://localhost:3000.


## Routes disponibles à ce jour

* GET / : Page d'accueil pour la recherche LDAP.
* POST /search : Effectue une recherche sur les entrées LDAP.
* GET /edit/:dn : Accède à la page d'édition d'une entrée LDAP.
* POST /update-attributeCtl : Met à jour le format des attributs d'une entrée LDAP.
* GET /logout : Déconnexion et réinitialisation de la connexion LDAP.


## Fonctions utilitaires de contrôle des saisies d'attributs

1. Contrôle de saisie de l'attribut 'sn' :

```
function check(input, data, initialValue) {
 // Convertit la valeur saisie en majuscules  
 input.value = input.value.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
 input.value = input.value.toUpperCase();

 // Calcul automatique du 'cn' à partir de (givenName+' '+input.value)
 let givenName = '';
 data.forEach(objectClass => {if (objectClass.givenName && objectClass.givenName.value) givenName = objectClass.givenName.value.trim();});
 data.forEach(objectClass => {if (objectClass.cn) objectClass.cn.value = (givenName.length ? `${givenName} ${input.value}`.trim() : input.value);});
}
```


2. Contrôle de saisie de l'attribut 'cn' (readOnly, puisque calculé)' :

 ![](doc/images/attributsCheck.png)


3. Contrôle de saisie de l'attribut 'givenName' :

```
function check(input, data, initialValue) {
 // Convertit la valeur saisie en majuscules
 input.value = input.value.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
 input.value = input.value.charAt(0).toUpperCase() + input.value.slice(1).toLowerCase();

 // Calcul automatique de 'cn' à partir de ${input.value+' '+sn}
 let sn='';
 data.forEach(objectClass => {if (objectClass.sn && objectClass.sn.value) sn = objectClass.sn.value.trim();});
 data.forEach(objectClass => {if (objectClass.cn) objectClass.cn.value = (input.value ? `${input.value} ${sn}`.trim() : sn);});
}
```


3. (à suivre) ...


 ![](doc/images/edit.png)


## Contribuer

Les contributions sont les bienvenues ! Pour contribuer :

Forkez le projet.

Créez une nouvelle branche (git checkout -b feature/YourFeature).
Commitez vos modifications (git commit -m 'Add some feature').
Poussez votre branche (git push origin feature/YourFeature).
Créez une nouvelle Pull Request.


Remarques :

Remplacez l'URL de clonage du dépôt Git par celle de votre propre dépôt.
Assurez-vous que le fichier config.json est mentionné correctement dans le README pour refléter votre configuration.
Adaptez le contenu selon vos besoins ou ajoutez des informations supplémentaires qui pourraient être utiles aux utilisateurs de votre application.

## Licence

Ce projet est sous licence GNU General Public Licence. Consultez le fichier LICENSE pour plus d'informations. ```

