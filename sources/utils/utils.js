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
/*            if (value1.length !== value2.length) {
                return false; // Les tableaux ont des longueurs différentes  
            }
            // Compare chaque élément des tableaux  
            for (let i = 0; i < value1.length; i++) {
                if (!isEqual(value1[i], value2[i])) {
                    return false; // Un élément ne correspond pas  
                }
            }
            return true; // Tous les éléments correspondent */
			return arraysEqualWithDuplicates(value1, value2);
        }

        // Si ce sont des objets (non tableaux)
        const keys1 = Object.getOwnPropertyNames(value1);
        const keys2 = Object.getOwnPropertyNames(value2);

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

const arraysEqualWithDuplicates = (arr1, arr2) => {
        if (arr1.length !== arr2.length)            return false;
        const arr2Copy = [...arr2]; // Copie de arr2
        for (let item of arr1) {
            const index = arr2Copy.indexOf(item);
            if (index === -1)                       return false;
            arr2Copy.splice(index, 1); // Supprime l'élément à l'index trouvé  
        }
        // Si arr2Copy est vide après le parcours de arr1, les tableaux sont égaux  
        return arr2Copy.length === 0;
    };

module.exports = { isEqual };
