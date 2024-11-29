function check(input, data, initialValue) { // Exemple de procédure de contrôle de saisie JS stockée dans la base ...
    let value = input.value.replace(/[^0-9/]/g, '').replace(/\/+/g, '/');
    if (
        (value.length === 1 && parseInt(value.slice(0, 1), 10) > 3) ||
        (value.length < 3 && parseInt(value.slice(0, 2), 10) > 31) ||
        (value.length < 5 && parseInt(value.slice(3, 4), 10) > 1) ||
        (value.length < 6 && parseInt(value.slice(3, 5), 10) > 12) ||
        (value.length > 2 && value[2] !== '/') ||
        (value.length > 5 && value[5] !== '/') ||
        (value.length > 10)
    ) value = value.slice(0, -1);
    input.value = value;
}
