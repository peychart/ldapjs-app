function initializePopup(input) {
	// Sauvegarder la defaultValue (modifiée à chaque chagement javascript de value)
	input.setAttribute('data-value', input.defaultValue);
	input.setAttribute('data-default-value', input.defaultValue);
	input.setAttribute('data-index', 0);

	let adding = false;
	let options = JSON.parse(input.value || []); // Créer une copie des valeurs initiales
	index(0); // Index de la position de la sélection
	// Stocker le gestionnaire oninput existant, s'il y en a un
	const originalOnInput = (typeof input.oninput === 'function') ?input.oninput :null;
	input.removeAttribute('oninput');

	// Création de la popup d'affichage des MULTI-VALUES
	const popupOptions = document.createElement('div');
	popupOptions.className = 'popup'; popupOptions.classList.add('hidden');
	input.parentElement.appendChild(popupOptions);

	// Fonction pour rendre les options dans la popup
	function renderOptions() {
		popupOptions.innerHTML = ''; // Vider les options existantes
		options.forEach((value, i) => {
			const optionElement = document.createElement('div');
			optionElement.className = 'option' + (i === index() ? ' selected' : ''); // Ajout de la classe 'selected' si c'est l'index actuel
			optionElement.textContent = value;
			popupOptions.appendChild(optionElement);
		});
	}

	function index(i=-1) {
		let index = input.getAttribute('data-index');
		if (i >= 0) {index = i < options.length ?i :0; input.value = options[index] ?? '';}
		input.setAttribute('data-index', index);
		return parseInt(index, 10);
	}

	// Mise à jour de la valeur pointée par l'index en temps réel
	function inputChanged() {
		options[index()] = input.value; // Mettre à jour la valeur actuelle pointée par l'index
		options = options.filter(item => item !== "");
		if (index() >= options.lengt && options.length) index(options.length-1);
		input.setAttribute('data-value', JSON.stringify(options)); // Mettre à jour les multi-values
		renderOptions(); // Rendre les options pour mettre à jour

		// Appeler le gestionnaire oninput de l'utilisateur, s'il est défini
		if (originalOnInput)
			try {
				originalOnInput(); // Appeler le gestionnaire oninput utilisateur
			} catch (error) {
				console.error('Erreur dans le gestionnaire oninput de l\'utilisateur:', error);
	}		}
	input.addEventListener('input', () => {inputChanged();});

	// Ouvrir la popup lorsque le champ input reçoit le focus
	input.addEventListener('focus', () => {
		const values = JSON.parse(input.getAttribute('data-value') || "[]");
		if (values.length > 1) {									// Vérifiez qu'il y a au moins 2 valeurs
			renderOptions();										// Rendre les options dans la popup
			const rect = input.getBoundingClientRect();
			popupOptions.style.width = `${input.offsetWidth}px`;	// Ajuster la largeur pour qu'elle corresponde à l'input
			popupOptions.style.top = `${rect.bottom + window.scrollY - 45}px`; // Positionner juste en dessous du champ
			setTimeout(() => {popupOptions.style.display = 'block';}, 0);
		} index();
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
	function exitInput() {
		adding = false;
		options = options.filter(item => item !== "");
		input.setAttribute('data-value', JSON.stringify(options)); // Mettre à jour les multi-values
		if (!input.value && options.length) index(0);
		if (!popupOptions.contains(event.target)
				&& !input.contains(event.target)
		) popupOptions.style.display = 'none'; // Fermer la popup
	} document.addEventListener('click', (event) => {exitInput();});

	// Fonction pour ajouter une nouvelle option
	function addNewOption() {
		adding = true;
		// Ajouter une nouvelle ligne vide pour l'édition
		options.push(''); // Ajouter une nouvelle valeur vide (pour l'édition)
		index(options.length - 1); // Mettre l'index sur la nouvelle valeur
		input.setAttribute('data-value', JSON.stringify(options)); // Mettre à jour les multi-values
		renderOptions(); // Rendre les options pour mettre à jour
	}

	// Gestionnaire d'événements
	input.addEventListener('keydown', (event) => { // Ajouter une nouvelle option
		if (event.key === 'Enter') { // Vérifier si la touche appuyée est <Enter>
			exitInput(); input.focus();
			event.preventDefault(); // Empêcher le comportement par défaut du bouton
			addNewOption(); // Appeler la fonction pour ajouter une nouvelle option
		} else if (event.key === 'Escape') {
			if (adding) {
				options.pop(); index(options.length-1); renderOptions();
			} adding = false;
		} else if (event.key === 'ArrowDown' || event.key === 'ArrowUp') { adding = false;
			event.preventDefault(); // Empêcher le comportement par défaut du bouton
			let i = index();
			index ( (event.key === 'ArrowDown')
				? (i + 1) % options.length
				: (i - 1 + options.length) % options.length );	// Passer à l'option suivante ou précédente
			renderOptions();
		}
	});
}

// Initialiser toutes les popups lorsque le DOM est chargé
document.addEventListener('DOMContentLoaded', function() {
	document.querySelectorAll('input.multi-values').forEach(input => {
		if (input instanceof HTMLInputElement)
			initializePopup(input); // Appeler la fonction d'initialisation pour chaque input multi-values
	});
});
