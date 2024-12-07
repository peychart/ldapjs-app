function initializePopup(input) {
	// Sauvegarder la defaultValue (modifiée à chaque chagement javascript de value)
	input.setAttribute('data-values', input.defaultValue || []);
	input.setAttribute('data-default-values', input.defaultValue) || [];
	input.setAttribute('data-index', 0);

	let adding = -1;
	let options = JSON.parse(input.getAttribute('data-values')); // Créer une copie des valeurs initiales
	input.value = options[index(0)] || '';

	// Création de la popup d'affichage des MULTI-VALUES
	const popupOptions = document.createElement('div');
	popupOptions.className = 'popup'; popupOptions.classList.add('hidden');
	input.parentElement.appendChild(popupOptions);

	// Event de sélection d'une option dans la popup
	popupOptions.addEventListener('click', (event) => {
		const clickedOption = event.target.closest('.option'); // Trouver l'élément .option cliqué
		if (clickedOption) {
			// Mettre à jour l'index
			input.value = options[index(Array.from(popupOptions.children).indexOf(clickedOption))] || '';
			input.focus();
		}
	});

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
			optionElement.className = 'option' + (i === index() ? ' selected' : ''); // Ajout de la classe 'selected' sur l'index actuel
			optionElement.textContent = value.length ?value :'...';
			popupOptions.appendChild(optionElement);
		});
		// Afficher la popup
		const rect = input.getBoundingClientRect();
		popupOptions.style.width = `${input.offsetWidth}px`;	// Ajuster la largeur sur celle de l'input
		popupOptions.style.top = `${rect.bottom + window.scrollY - 45}px`; // juste sous le champ
//		setTimeout(() => {popupOptions.style.display = 'block';}, 0);
		popupOptions.style.display = 'block';
	}

	// Ouvrir la popup lorsque le champ input reçoit le focus
	input.addEventListener('focus', () => {	// Laisser le temps au popup de se refermer sur click ...
		setTimeout(() => {renderOptions();}, 250);	// pour ensuite se ré-ouvrir.
	});

	// Sauvegarde de l'event oninput existant, s'il y a
	const originalOnInput = (typeof input.oninput === 'function') ?input.oninput :null;

	input.removeAttribute('oninput');
	// Mise à jour de la valeur pointée par l'index en temps réel
	input.addEventListener('input', () => {
		options[index()] = input.value; // Mettre à jour la valeur actuelle pointée par l'index
		if (!input.value.length && adding<0) {	// DELETE de la valeur d'index()
			options = options.filter(item => item !== "");	// Filtre les options vides
			if (index() >= options.length && options.length) index(options.length-1);
			input.value = options[index()] || '';
		}
		input.setAttribute('data-values', JSON.stringify(options)); // Mettre à jour les multi-values
		renderOptions(); // Rendre les options pour mettre à jour
	}); if (originalOnInput) input.addEventListener('input', originalOnInput);

	// Sur perte du focus de input ET popupOptions, fermer la popup
	input.addEventListener('blur', () => {
		setTimeout( () => {if (document.activeElement === popupOptions) {
			input.focus();
		} else {
			if (adding>=0 && !input.value.length) {
				options.splice(adding, 1);
				index(options.length - 1);
			}
			if (!input.value.length && options.length) index(options.length - 1);
			input.value = options[index()] || '';
			input.setAttribute('data-values', JSON.stringify(options)); // Mettre à jour les multi-values
			popupOptions.style.display = 'none'; // Fermer la popup
		};}, 250);	// laisser le temps de l'event click pour le popup ...
		adding = -1;
	});

	// Gestionnaire d'événements
	input.addEventListener('keydown', (event) => { // Ajouter une nouvelle option
		if (event.key === 'Enter') { // Vérifier si la touche appuyée est <Enter>
			options.push(input.value=''); index(adding = options.length - 1); // Ajouter d'une nouvelle valeur
			renderOptions(); // Rendre les options pour mettre à jour
		} else if (event.key === 'Escape') {
			if (adding>=0) {
				options.splice(adding, 1); adding = -1;
				input.value = options[index(options.length-1)] || '';
				//renderOptions();
				triggerInputEvent(input);
			}
		} else if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
			if(adding>=0) {
				input.value = options[index(options.length-1)] || '';
			} else {
				let i = index();
				index ( (event.key === 'ArrowDown')
					? (i + 1) % options.length
					: (i - 1 + options.length) % options.length );	// Passer à l'option suivante ou précédente
				input.value = options[index()] || '';
				renderOptions();
		}	}
	});

	function triggerInputEvent(input) {
		// Crée un nouvel événement input  
		const event = new Event('input', {
			bubbles: true, // L'événement peut se propager  
			cancelable: true // L'événement peut être annulé  
		});

		// Déclenche l'événement sur l'élément  
		input.dispatchEvent(event);
	}
}

// Initialiser toutes les popups lorsque le DOM est chargé
document.addEventListener('DOMContentLoaded', function() {
	document.querySelectorAll('input.multi-values').forEach(input => {
		if (input instanceof HTMLInputElement)
			initializePopup(input); // Appeler la fonction d'initialisation pour chaque input multi-values
	});
});
