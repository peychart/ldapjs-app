function initializePopup(container) {
	const editInput = container.querySelector('.editInput');
	const hiddenInput = editInput.cloneNode(true); // Création du champ caché pour values au formulaire
	hiddenInput.classList.add('cloned'); hiddenInput.type = 'hidden';
	hiddenInput.setAttribute('data-default-value', hiddenInput.defaultValue);
	editInput.removeAttribute('name'); editInput.removeAttribute('oninput');
	editInput.parentElement.appendChild(hiddenInput);
	const popupOptions = document.createElement('div');
	popupOptions.className = 'popup'; popupOptions.classList.add('hidden');
	editInput.parentElement.appendChild(popupOptions); // Création de la popup d'affichage des MULTI-VALUES

	let index = 0; // Index de la position de la sélection  
	let options = JSON.parse(hiddenInput.value.length>0 ?editInput.value :[]); // Créer une copie des valeurs initiales

	// Initialiser le champ d'entrée et le champ caché avec la première valeur  
	editInput.value = options.length > 0 ?options[index] :'';

	// Fonction pour rendre les options dans la popup  
	function renderOptions() {
		popupOptions.innerHTML = ''; // Vider les options existantes  
		options.forEach((value, i) => {
			const optionElement = document.createElement('div');
			optionElement.className = 'option' + (i === index ? ' selected' : ''); // Ajout de la classe 'selected' si c'est l'index actuel  
			optionElement.textContent = value;
			popupOptions.appendChild(optionElement);
		});
	}

	// Ouvrir la popup lorsque le champ input reçoit le focus  
	editInput.addEventListener('focus', () => {
		const values = JSON.parse(hiddenInput.value || "[]"); // Récupérez les valeurs du champ caché  
		if (values.length > 1) { // Vérifiez qu'il y a au moins 2 valeurs  
			const rect = editInput.getBoundingClientRect();
			popupOptions.style.display = 'block';
			popupOptions.style.width = `${editInput.offsetWidth}px`; // Ajuster la largeur pour qu'elle corresponde à l'input
			popupOptions.style.top = `${rect.bottom + window.scrollY - 45}px`; // Positionner juste en dessous du champ  
//			popupOptions.style.left = `${rect.left}px`; // Aligner avec le champ  
			renderOptions(); // Rendre les options dans la popup  
		}
	});

	// Mise à jour de la valeur pointée par l'index en temps réel  
	editInput.addEventListener('input', () => {
		options[index] = editInput.value; // Mettre à jour la valeur actuelle pointée par l'index  
		options = options.filter(item => item !== ""); 
		hiddenInput.value = JSON.stringify(options); // Mettre à jour le champ caché  
		renderOptions(); // Rendre les options pour mettre à jour  
		hiddenInput.dispatchEvent(new Event('input', { bubbles: true, cancelable: true }));
	});

	// Sélection d'une option dans la popup  
	popupOptions.addEventListener('click', (event) => {
		const clickedOption = event.target.closest('.option'); // Trouver l'élément .option cliqué  
		if (clickedOption) {
			index = Array.from(popupOptions.children).indexOf(clickedOption); // Mettre à jour l'index  
			editInput.value = options[index]; // Mettre la valeur sélectionnée dans le champ d'entrée  
			hiddenInput.value = JSON.stringify(options); // Mettre à jour le champ caché  
			//hiddenInput.dispatchEvent(new Event('input', { bubbles: true, cancelable: true }));
			popupOptions.style.display = 'none'; // Fermer la popup après sélection  
			renderOptions(); // Rendre les options pour mettre à jour la sélection  
		}
	});

	// Fermer la popup si l'utilisateur clique en dehors  
	document.addEventListener('click', (event) => {
		options = options.filter(item => item !== ""); 
		if (options.length > 0) editInput.value = options[(index=0)];
		hiddenInput.value = JSON.stringify(options);
		hiddenInput.dispatchEvent(new Event('input', { bubbles: true, cancelable: true }));
		if (!popupOptions.contains(event.target)
				&& !editInput.contains(event.target)
		)	popupOptions.style.display = 'none'; // Fermer la popup  
	});

	// Fonction pour ajouter une nouvelle option  
	function addNewOption() {
		// Ajouter une nouvelle ligne vide pour l'édition
		options.push(''); // Ajouter une nouvelle valeur vide (pour l'édition)
		index = options.length - 1; // Mettre l'index sur la nouvelle valeur
		editInput.value = options[index]; // Commencer l'édition dans le champ d'entrée
		hiddenInput.value = JSON.stringify(options); // Mettre à jour le champ caché temporairement pour la gestion des options
		renderOptions(); // Rendre les options pour mettre à jour
		editInput.dispatchEvent(new Event('focus', { bubbles: true, cancelable: true }));
	}

	// Gestionnaire d'événements
	editInput.addEventListener('keydown', (event) => { // Ajouter une nouvelle option
		if (event.key === 'Enter') { // Vérifier si la touche appuyée est <Enter>
				event.preventDefault(); // Empêcher le comportement par défaut du bouton
				addNewOption(); // Appeler la fonction pour ajouter une nouvelle option
		} else if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
			event.preventDefault(); // Empêcher le comportement par défaut du bouton
			index = (event.key === 'ArrowDown')
				? (index + 1) % options.length
				: (index - 1 + options.length) % options.length; // Passer à l'option suivante ou précédente  
			editInput.value = options[index]; // Mettre à jour l'input avec la valeur actuelle
			renderOptions();
		}
	});
}

// Initialiser toutes les popups lorsque le DOM est chargé  
document.addEventListener('DOMContentLoaded', function() {
	document.querySelectorAll('.popupContainer').forEach(container => {
		initializePopup(container); // Appeler la fonction d'initialisation pour chaque conteneur  
	});
});
