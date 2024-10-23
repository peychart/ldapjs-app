// utils/log.js

const fs = require('fs');
const path = require('path');
const winston = require('winston');
const DailyRotateFile = require('winston-daily-rotate-file');
const config = require('../config.json'); // Charger le fichier de configuration

// Extraire le répertoire à partir du chemin complet du fichier de log  
const logDir = path.dirname(config.logFile) || '..'; // Répertoire du fichier de log  
const logFile = path.basename(config.logFile); // Nom du fichier de log

function createLogger() {
    try {
        // Vérifiez si le répertoire de logs existe déjà, sinon essayez de le créer  
        if (!fs.existsSync(logDir)) {
            fs.mkdirSync(logDir, { recursive: true }); // Crée le répertoire et les sous-répertoires si nécessaire  
            console.log('Répertoire de logs créé avec succès.');
        }

        // Vérifiez si le fichier de log existe déjà, sinon il sera créé automatiquement  
        if (!fs.existsSync(path.join(logDir, logFile))) {
            fs.writeFileSync(path.join(logDir, logFile), ''); // Crée le fichier de log s'il n'existe pas  
            console.log('Fichier de log créé avec succès.');
        }

        // Configurer le transport de rotation quotidien pour les logs  
        const transport = new DailyRotateFile({
            filename: path.join(logDir, logFile.replace('.log', '-%DATE%.log')), // Remplace le nom pour la rotation  
            datePattern: 'YYYY-MM-DD',
            zippedArchive: true,
            maxSize: '20m',
            maxFiles: '14d' // Conserver les logs pendant 14 jours  
        });

        // Configurer le logger avec winston  
        const logger = winston.createLogger({
            level: 'info',
            format: winston.format.combine(
                winston.format.timestamp(),
                winston.format.json()
            ),
            transports: [
                transport  
            ]
        });

        // Exemple d'utilisation du logger  
        logger.info('Logger configuré avec succès.');

        return logger; // Retourne le logger configuré

    } catch (error) {
        // Gestion d'erreur : affichez un message d'erreur et arrêtez l'application  
        console.error('Erreur lors de la configuration des logs:', error);
        process.exit(1); // Arrête l'application avec un code d'erreur  
    }
}

// Exporter la fonction pour créer le logger  
module.exports = createLogger;
