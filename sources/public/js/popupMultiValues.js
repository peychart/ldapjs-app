function initializePopup(input) {
	// Sauvegarder la defaultValue (modifiée à chaque chagement javascript de value)
	input.setAttribute('data-value', input.defaultValue);
	input.setAttribute('data-default-value', input.defaultValue);
	input.setAttribute('data-index', 0);

	let adding = false;
	let options = JSON.parse(input.value || []); // Créer une copie des valeurs initiales
	input.value = options[index(0)];

	// Sauvegarde de l'event oninput existant, s'il y a
	const originalOnInput = (typeof input.oninput === 'function') ?input.oninput :null;
	input.removeAttribute('oninput');

	// Création de la popup d'affichage des MULTI-VALUES
	const popupOptions = document.createElement('div');
	popupOptions.className = 'popup'; popupOptions.classList.add('hidden');
	input.parentElement.appendChild(popupOptions);

	// Gestion de l'index, position courante dans la popup
	function index(i=-1) {
		if (i >= 0)
			input.setAttribute('data-index', i<options.length ?i :0);
		return parseInt(input.getAttribute('data-index'), 10);
	}

	// Fonction pour rendre les options dans la popup
	function renderOptions() {
		popupOptions.innerHTML = ''; // Vider les options existantes
		options.forEach((value, i) => {
			const optionElement = document.createElement('div');
			optionElement.className = 'option' + (i === index() ? ' selected' : ''); // Ajout de la classe 'selected' si c'est l'index actuel
			optionElement.textContent = value.length ?value :'...';
			popupOptions.appendChild(optionElement);
		});
		// Afficher la popup
		const rect = input.getBoundingClientRect();
		popupOptions.style.width = `${input.offsetWidth}px`;	// Ajuster la largeur sur celle de l'input
		popupOptions.style.top = `${rect.bottom + window.scrollY - 45}px`; // juste sous le champ
		setTimeout(() => {popupOptions.style.display = 'block';}, 0);
	}

	// Ouvrir la popup lorsque le champ input reçoit le focus
	input.addEventListener('focus', () => {
		options = JSON.parse(input.getAttribute('data-value'));
		renderOptions();	// Rendre les options dans la popup

if (input.name === 'telephoneNumber'){
console.log('->focusEvent: ');
console.log('telephoneNumber: ', input.getAttribute('data-value'));
}

	});

	// Mise à jour de la valeur pointée par l'index en temps réel
	input.addEventListener('input', () => {
		options[index()] = input.value; // Mettre à jour la valeur actuelle pointée par l'index
		options = options.filter(item => item !== "");
		if (index() >= options.lengt && options.length) index(options.length-1);
		input.setAttribute('data-value', JSON.stringify(options)); // Mettre à jour les multi-values
		renderOptions(); // Rendre les options pour mettre à jour

		// Appeler le gestionnaire oninput de l'utilisateur, s'il est défini
		if (originalOnInput) {
			try {
				originalOnInput(); // Appeler le gestionnaire oninput utilisateur
			} catch (error) {
				console.error('Erreur dans le gestionnaire oninput de l\'utilisateur:', error);
		}	}
	});

	// Sélection d'une option dans la popup
	popupOptions.addEventListener('click', (event) => {
		const clickedOption = event.target.closest('.option'); // Trouver l'élément .option cliqué
		if (clickedOption) {
			index(Array.from(popupOptions.children).indexOf(clickedOption)); // Mettre à jour l'index
			input.focus();
		}
	});

	// Fermer la popup si l'utilisateur clique en dehors
	document.addEventListener('click', (event) => {
		// Sur perte du focus, hidden la popup
		if (!input.contains(event.target) && !popupOptions.contains(event.target)) {
			adding = false;
			options = options.filter(item => item !== "");	// Filtre les options vides
			if (!input.value.length && options.length)
				input.value = options[index(0)];
			popupOptions.style.display = 'none'; // Fermer la popup

if (input.name === 'telephoneNumber') {
console.log('->clickEvent: ');
console.log('telephoneNumber: ', input.getAttribute('data-value'));
}

	}	});

	// Gestionnaire d'événements
	input.addEventListener('keydown', (event) => { // Ajouter une nouvelle option
		if (event.key === 'Enter') { // Vérifier si la touche appuyée est <Enter>
			adding = true;
			options.push(input.value=''); index(options.length - 1); // Ajouter d'une nouvelle valeur
			renderOptions(); // Rendre les options pour mettre à jour
		} else if (event.key === 'Escape') {
			if (adding) {
				options.pop();
				input.value = options[index(options.length-1)];
				renderOptions();
				adding = false;
			}
		} else if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
			if(!adding || options[index()].length) {
				if (adding)
					input.setAttribute('data-value', JSON.stringify(options)); // Mettre à jour les multi-values
				adding = false;
				event.preventDefault(); // Empêcher le comportement par défaut du bouton
				let i = index();
				index ( (event.key === 'ArrowDown')
					? (i + 1) % options.length
					: (i - 1 + options.length) % options.length );	// Passer à l'option suivante ou précédente
				input.value = options[index()];
				renderOptions();
		}	}
	});
}

// Initialiser toutes les popups lorsque le DOM est chargé
document.addEventListener('DOMContentLoaded', function() {
	document.querySelectorAll('input.multi-values').forEach(input => {
		if (input instanceof HTMLInputElement)
			initializePopup(input); // Appeler la fonction d'initialisation pour chaque input multi-values
	});
});
