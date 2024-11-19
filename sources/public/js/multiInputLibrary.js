function createSingleInput(elementId, modalTitle = "Zone de saisie", initialValues = []) {
    // Créer les éléments HTML  
    const container = document.createElement('div');
    const input = document.createElement('input');
    const dropdown = document.createElement('div');
    const button = document.createElement('button');
    const selectedValuesDiv = document.createElement('div');

    // Configurer l'élément d'entrée  
    input.type = 'text';
    input.id = elementId;
    input.placeholder = 'Saisissez une valeur ici...';
    input.className = 'form-control mb-3';

    dropdown.className = 'dropdown-menu';
    button.className = 'btn btn-primary mt-3';
    button.textContent = 'Obtenir la valeur sélectionnée';
    button.id = `getValues_${elementId}`; // Associer un ID unique au bouton

    selectedValuesDiv.id = `selectedValues_${elementId}`; // Associer un ID unique à la section des valeurs sélectionnées

    container.appendChild(input);
    container.appendChild(dropdown);
    container.appendChild(button);
    container.appendChild(selectedValuesDiv);
    document.body.appendChild(container);

    // Ajouter la modale  
    const modalHTML = `
        <div class="modal fade" id="inputModal_${elementId}" tabindex="-1" role="dialog" aria-labelledby="inputModalLabel" aria-hidden="true">
            <div class="modal-dialog" role="document">
                <div class="modal-content">
                    <div class="modal-header">
                        <h5 class="modal-title" id="inputModalLabel">${modalTitle}</h5>
                        <button type="button" class="close" data-dismiss="modal" aria-label="Close">
                            <span aria-hidden="true">&times;</span>
                        </button>
                    </div>
                    <div class="modal-body">
                        <textarea id="${elementId}_values" placeholder="Ajoutez plusieurs valeurs, une par ligne..." class="form-control"></textarea>
                    </div>
                    <div class="modal-footer">
                        <button type="button" class="btn btn-secondary" data-dismiss="modal">Fermer</button>
                    </div>
                </div>
            </div>
        </div>
    `;
    document.body.insertAdjacentHTML('beforeend', modalHTML);

    // Remplir la zone de texte avec les valeurs initiales  
    if (initialValues.length > 0) {
        $(`#${elementId}_values`).val(initialValues.join('\n'));
    }

    // Ouvrir la modale sur le focus de l'input  
    input.addEventListener('focus', function () {
        $(`#inputModal_${elementId}`).modal('show'); // Afficher la modale pour ce champ de saisie  
    });

    // Gérer l'affichage des listes déroulantes  
    $(input).on('mouseenter', function () {
        const values = $(`#${elementId}_values`).val().split('\n').filter(item => item.trim() !== '');
        $(dropdown).empty();

        if (values.length > 0) {
            values.forEach(value => {
                const item = $('<div class="dropdown-item"></div>').text(value);
                item.on('click', function () {
                    $(input).val(value); // Mettre la valeur dans l'input  
                    $(dropdown).hide(); // Cacher la liste déroulante  
                });
                $(dropdown).append(item);
            });
            $(dropdown).css({
                display: 'block',
                top: $(input).offset().top + $(input).outerHeight(),
                left: $(input).offset().left  
            });
        } else {
            $(dropdown).hide(); // Cacher si aucune valeur  
        }
    }).on('mouseleave', function () {
        $(dropdown).hide(); // Cacher lorsque la souris quitte le champ  
    });

    // Cacher la liste déroulante lorsque l'on clique à l'extérieur  
    $(document).click(function (e) {
        if (!$(e.target).closest(input).length) {
            $(dropdown).hide();
        }
    });

    // Mettre le focus sur la zone de texte lors de l'ouverture de la modale  
    $(`#inputModal_${elementId}`).on('shown.bs.modal', function () {
        $(`#${elementId}_values`).focus(); // Mettre le focus sur la zone de texte  
    });

    // Mettre à jour l'input à la fermeture de la modale  
    $(`#inputModal_${elementId}`).on('hidden.bs.modal', function () {
        const firstLine = $(`#${elementId}_values`).val().split('\n')[0] || '';
        $(input).val(firstLine);
    });

    // Bouton pour obtenir la valeur  
    $(button).click(function () {
        const value = $(input).val();
        const values = $(`#${elementId}_values`).val().split('\n').filter(item => item.trim() !== '');

        let combinedValues = [];
        if (value.trim()) {
            combinedValues.push(value);
        }
        combinedValues = combinedValues.concat(values);

        $(`#${selectedValuesDiv.id}`).html(`
            <h4>Valeurs sélectionnées :</h4>
            <p>${combinedValues.join(', ')}</p>
        `);
    });
}
