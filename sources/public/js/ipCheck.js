// WARNING: SINGLE-VALUE attribute version:
function check(input, data, initialValue) {
    let value = input.value.replace(/[^0-9.]/g, '');
    const parts = value.split('.');
    // Limiter le nombre de parties à 4
    if (parts.length > 4) value = parts.slice(0, 4).join('.');

    // Vérifier chaque partie
    for (let i = 0; i < parts.length; i++) {
        const part = parts[i];
        // Retirer les zéros non significatifs
        if (part.length > 1 && part[0] === '0') parts[i] = part.replace(/^0+/, '');
        // Si la partie est vide ou > 255, la retirer
        if (part === '' || parseInt(part, 10) > 255) parts[i] = '';
    }
    // Rejoindre les parties pour former l'adresse IP
    value = parts.filter(part => part !== '').join('.');

    // Validation ou annulation sur sortie du champ de saisie
    const blurHandler = input.onblur = function() {
        if (!isValidIP(value))
                input.value = initialValue;
        else    input.value = value;
        input.removeEventListener('blur', blurHandler);
    };
}
function isValidIP(value) {
    const regex = /^(25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.(25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.(25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.(25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)$/;
    return regex.test(value);
}
