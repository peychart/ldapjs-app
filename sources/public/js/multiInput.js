// Exemple de fonction qui s'exécute lors du chargement de la page pour créer l'objet
//window.onload = function() {createMultiValuesInput();};
//document.addEventListener('DOMContentLoaded', createMultiValuesInput('.container', '.multiValuesEditClass'));


function createMultiValuesInput(containerClass, inputClass) {
    const containers = document.querySelectorAll(containerClass);
    containers.forEach(container => {
        const input = container.querySelector('input[type="text"]' + inputClass);
		if (input)
            createPopupForInput(input, container); // Créer le champ pour chaque input  
		else
			console.warn('Aucun input trouvé avec le sélecteur:', 'input[type="text"]' + inputClass);
    });
}

function createPopupForInput(input, container) {
    const values = []; // Tableau pour stocker les valeurs saisies  
    let selectedValue = null; // Valeur actuellement sélectionnée
console.log('input' + input.name + 'initialisé! ');

    // Créer une div englobante pour l'input, les boutons et le textarea  
    const inputWrapper = document.createElement('div');
    inputWrapper.className = 'input-wrapper';
    container.appendChild(inputWrapper); // Ajouter l'englobement au conteneur

    // Déplacer l'input à l'intérieur de la nouvelle div  
    inputWrapper.appendChild(input);

    // Créer et ajouter les boutons + et - dans le wrapper  
    const addButton = document.createElement('button');
    addButton.textContent = '+';
    addButton.className = 'add-button';
    inputWrapper.appendChild(addButton); // Ajouter le bouton + dans le wrapper

    const removeButton = document.createElement('button');
    removeButton.textContent = '-';
    removeButton.className = 'remove-button';
    removeButton.disabled = true; // Désactiver le bouton - par défaut  
    inputWrapper.appendChild(removeButton); // Ajouter le bouton - dans le wrapper

    // Créer un champ textarea pour afficher les éléments du tableau  
    const textArea = document.createElement('textarea');
    textArea.rows = 5; // Nombre de lignes par défaut  
    textArea.style.display = 'none'; // Masquer par défaut  
    textArea.style.width = `${input.offsetWidth}px`; // Ajuster la largeur pour qu'elle corresponde à l'input  
    textArea.style.overflowY = 'auto'; // Permettre le défilement  

    // Créer un champ cacher pour soumission du formulaire
    const hiddenInput = input.cloneNode(false);
    hiddenInput.type = 'hidden'; //Champ hidden pour transmettre les valeurs au formulaire
    inputWrapper.appendChild(hiddenInput); // Ajouter le hiddenInput - dans le wrapper

    // Définir le name du textarea comme l'original (avant la modification)
    //textArea.name = input.name; // Le name du textarea est le name d'origine de l'input  
    inputWrapper.appendChild(textArea); // Ajouter le textarea dans le wrapper

    // Modifier le name de l'input pour y ajouter le suffixe "_multivalues"
    //input.name = input.name + "_multivalues"; 
    input.removeAttribute('name');

    // Initialiser les valeurs existantes dans l'input 
    if (input.value) {
        try {
            const parsedValues = JSON.parse(input.value);
            if (Array.isArray(parsedValues)) {
                values.push(...parsedValues); // Ajouter les valeurs au tableau  
            } else {
                values.push(input.value); // Ajouter la valeur d'entrée si ce n'est pas un tableau 
            }
        } catch (e) {
            console.error('Failed to parse input value:', e);
        }
    }

    // Mettre à jour l'input avec la première valeur si elle existe  
    if (values.length > 0) {
        selectedValue = values[0]; // Mettre à jour la valeur sélectionnée  
        input.value = selectedValue; // Mettre l'input à la première valeur  
        removeButton.disabled = false; // Activer le bouton - si des valeurs existent  
        updateTextArea(); // Mettre à jour le textarea avec les valeurs initiales  
    } else {
        input.value = ''; // Réinitialiser l'input si aucune valeur  
    }

    // Fonction pour mettre à jour le textarea avec les valeurs  
    function updateTextArea() {
        textArea.value = values.join('\n'); // Mettre à jour le textarea avec toutes les valeurs du tableau sur des lignes séparées  
        textArea.rows = Math.max(values.length, 1); // Ajuster le nombre de lignes du textarea en fonction du nombre de valeurs  
	hiddenInput.value = JSON.stringify(values);
    }

    // Ajouter une valeur à la liste lors du clic sur le bouton +  
    addButton.addEventListener('click', () => {
        const newValue = ''; // Nouvelle ligne vide  
        values.push(newValue); // Ajouter la nouvelle valeur au tableau  
        selectedValue = newValue; // Mettre la valeur sélectionnée à la nouvelle ligne vide  
        input.value = selectedValue; // Mettre la sélection dans l'input  
        removeButton.disabled = false; // Activer le bouton -  
        textArea.style.display = 'block'; // Afficher le textarea  
        updateTextArea(); // Mettre à jour le textarea avec les valeurs actuelles  
        input.focus(); // Ramené le focus sur l'input pour une nouvelle saisie  
    });

    // Supprimer la valeur sélectionnée  
    removeButton.addEventListener('click', () => {
        if (selectedValue !== null) {
            const index = values.indexOf(selectedValue);
            if (index !== -1) {
                values.splice(index, 1); // Supprimer la valeur du tableau  
                selectedValue = null; // Réinitialiser la valeur sélectionnée  
                removeButton.disabled = true; // Désactiver le bouton -
                updateTextArea(); // Mettre à jour le textarea avec les valeurs actuelles  
                if (values.length > 0) {
                    selectedValue = values[0]; // Mettre à jour selectedValue avec la nouvelle première valeur  
                    input.value = selectedValue; // Mettre à jour l'input avec la nouvelle première valeur  
                } else {
                    input.value = ''; // Réinitialiser l'input s'il n'y a plus de valeurs  
                    textArea.style.display = 'none'; // Masquer le textarea s'il n'y a plus de valeurs  
                }
            }
        }
    });

    // Événement pour sélectionner une ligne dans le textarea  
    textArea.addEventListener('click', (event) => {
        const lines = textArea.value.split('\n');
        const cursorPosition = textArea.selectionStart;

        // Trouver l'index de la ligne sélectionnée  
        let selectedLineIndex = -1; 
        let lineStart = 0;

        for (let i = 0; i < lines.length; i++) {
            const lineLength = lines[i].length + 1; // +1 pour la nouvelle ligne  
            if (cursorPosition >= lineStart && cursorPosition < lineStart + lineLength) {
                selectedLineIndex = i;
                break;
            }
            lineStart += lineLength;
        }

        if (selectedLineIndex >= 0) {
            selectedValue = lines[selectedLineIndex]; // Mettre à jour la valeur sélectionnée  
            input.value = selectedValue; // Afficher la ligne sélectionnée dans l'input  
            removeButton.disabled = false; // Activer le bouton - si une valeur est sélectionnée  
            input.focus(); // Ramené le focus sur l'input après avoir sélectionné une ligne  
        }
    });

    // Événement pour mettre à jour le textarea lors de la modification de l'input  
    input.addEventListener('input', () => {
        if (selectedValue !== null) {
            const index = values.indexOf(selectedValue);
            if (index !== -1) {
                selectedValue = values[index] = input.value; // Remplacer l'ancienne valeur par la nouvelle saisie  
                updateTextArea(); // Mettre à jour l'affichage du textarea  
            }
        }
    });

    // Garder le textarea affiché  
    input.addEventListener('focus', () => {
        textArea.style.display = 'block'; // Afficher le textarea lors du focus sur l'input  
    });

    // Masquer le textarea si le clic se produit en dehors de l'input, du textarea et des boutons (+ ou -)  
    document.addEventListener('click', (event) => {
        if (!inputWrapper.contains(event.target)) {
            textArea.style.display = 'none'; // Masquer le textarea 
        }
    });
}