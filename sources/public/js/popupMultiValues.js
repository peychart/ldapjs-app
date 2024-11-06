	document.addEventListener('DOMContentLoaded', function() {
		document.querySelectorAll('.popupContainer').forEach(container => {
			const attrName = container.getAttribute('data-attr-name'); // Récupérer le nom dynamique  
			const initValues = JSON.parse(container.querySelector('.hiddenInput').value || "[]"); // Récupérer les valeurs initiales depuis le champ caché

			const editInput = container.querySelector('.editInput');
			const hiddenInput = document.getElementById(attrName); // Récupérer le champ caché par son ID  
			const popupOptions = container.querySelector('.popup');
			const addButton = container.querySelector('.add-button');
			let index = 0; // Index de la position de la sélection  
			let options = initValues.slice(); // Créer une copie des valeurs initiales

			// Initialiser le champ d'entrée et le champ caché avec la première valeur  
			if (options.length > 0) {
				editInput.value = options[index];
			}
			hiddenInput.value = JSON.stringify(options); // Stocker le tableau dans hiddenInput

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
				 if (values.length >= 2) { // Vérifiez qu'il y a au moins 2 valeurs
					const rect = editInput.getBoundingClientRect();
					popupOptions.style.display = 'block';
					popupOptions.style.top = `${rect.bottom + window.scrollY - 50}px`; // Positionner juste en dessous du champ  
					popupOptions.style.left = `${rect.left - 30}px`; // Aligner avec le champ  
					if (index >= options.length || index < 0) {
						index = 0; // Réinitialiser l'index à 0 si hors limites
					}
					editInput.value = options.length > 0 ? options[index] : ''; // Mettre à jour le champ d'entrée avec la valeur actuelle
					renderOptions(); // Rendre les options dans la popup  
				}
			});

			// Mise à jour de la valeur pointée par l'index en temps réel  
			editInput.addEventListener('input', () => {
				options[index] = editInput.value; // Mettre à jour la valeur actuelle pointée par l'index  
				hiddenInput.value = JSON.stringify(options); // Mettre à jour le champ caché  
				renderOptions(); // Rendre les options pour mettre à jour  
			});

			// Sélection d'une option dans la popup  
			popupOptions.addEventListener('click', (event) => {
				const clickedOption = event.target.closest('.option'); // Trouver l'élément .option cliqué  
				if (clickedOption) {
					index = Array.from(popupOptions.children).indexOf(clickedOption); // Mettre à jour l'index  
					editInput.value = options[index]; // Mettre la valeur sélectionnée dans le champ d'entrée  
					hiddenInput.value = JSON.stringify(options); // Mettre à jour le champ caché  
					renderOptions(); // Rendre les options pour mettre à jour la sélection  
//					editInput.focus(); // Replacer le focus sur l'input pour garder la popup ouverte  
				}
			});

			// Fermer la popup si l'utilisateur clique en dehors  
			document.addEventListener('click', (event) => {
				if (!popupOptions.contains(event.target) && event.target !== editInput) {
					options = options.filter(option => option !== ''); // Enlever les valeurs vides
					hiddenInput.value = JSON.stringify(options); // Mettre à jour le champ caché avec les options filtrées
					popupOptions.style.display = 'none'; // Fermer la popup  
				}
			});

			// Gestion de la navigation par les flèches haut/bas  
			editInput.addEventListener('keydown', (event) => {
				if (event.key === 'ArrowDown') {
					index = (index + 1) % options.length; // Passer à l'option suivante  
					renderOptions(); // Rendre les options pour mettre à jour  
					editInput.value = options[index]; // Mettre à jour l'input avec la valeur actuelle  
				} else if (event.key === 'ArrowUp') {
					index = (index - 1 + options.length) % options.length; // Passer à l'option précédente  
					renderOptions(); // Rendre les options pour mettre à jour  
					editInput.value = options[index]; // Mettre à jour l'input avec la valeur actuelle  
				} else if (event.key === 'Enter') {
					editInput.value = options[index]; // Mettre la valeur de l'option sélectionnée dans le champ d'entrée  
					hiddenInput.value = JSON.stringify(options); // Mettre à jour le champ caché  
					popupOptions.style.display = 'none'; // Fermer la popup après sélection  
				}
			});

			// Ajouter une option vide pour édition
			addButton.addEventListener('click', () => {
				const newValue = editInput.value.trim(); // Récupérer la valeur du champ de saisie et enlever les espaces vides
				if (newValue) {
					if (!options.includes('')) { options.push(''); }
					index = options.length - 1; // Positionner l'index sur la nouvelle ligne blanche
					hiddenInput.value = JSON.stringify(options); // Mettre à jour le champ caché
					editInput.value = ''; // Réinitialiser le champ de saisie pour une nouvelle entrée
					renderOptions(); // Mettre à jour le rendu des options
					editInput.focus();
				} else {
					alert("Veuillez entrer une valeur valide."); // Alerte si la valeur est vide
				}
			});
		});
	});
