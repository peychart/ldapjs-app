function isEqual(value1, value2) {
    // Vérifie si les deux valeurs sont identiques  
    if (value1 === value2) {
        return true;
    }

    // Vérifie si les deux valeurs sont des objets  
    if (typeof value1 === 'object' && value1 !== null && 
        typeof value2 === 'object' && value2 !== null) {
        
        // Si les deux valeurs sont des tableaux  
        if (Array.isArray(value1) && Array.isArray(value2)) {
            if (value1.length !== value2.length) {
                return false; // Les tableaux ont des longueurs différentes  
            }
            // Compare chaque élément des tableaux  
            for (let i = 0; i < value1.length; i++) {
                if (!isEqual(value1[i], value2[i])) {
                    return false; // Un élément ne correspond pas  
                }
            }
            return true; // Tous les éléments correspondent  
        }

        // Si ce sont des objets (non tableaux)
        const keys1 = Object.keys(value1);
        const keys2 = Object.keys(value2);

        if (keys1.length !== keys2.length) {
            return false; // Les objets ont des nombres de clés différents  
        }

        // Compare chaque clé et valeur  
        for (const key of keys1) {
            if (!keys2.includes(key) || !isEqual(value1[key], value2[key])) {
                return false; // Une clé ou une valeur ne correspond pas  
            }
        }
        return true; // Tous les clés et valeurs correspondent  
    }

    // Si ce ne sont ni des objets ni des tableaux, ils ne sont pas égaux  
    return false;
}

module.exports = { isEqual };
