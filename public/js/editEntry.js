// editEntry.js
// Depends on: gameData, regionData, entryPicksFromServer, teamData
// set as globals by the inline <script> block in editEntry.ejs

// --- Debounce function ---
function debounce(func, wait, immediate) {
    var timeout;
    return function () {
        var context = this, args = arguments;
        var later = function () {
            timeout = null;
            if (!immediate) func.apply(context, args);
        };
        var callNow = immediate && !timeout;
        clearTimeout(timeout);
        timeout = setTimeout(later, wait);
        if (callNow) func.apply(context, args);
    };
}

function updateBracketVisual() {
    const bracketContainer = document.getElementById('bracketRow');

    const containerWidth = bracketContainer.offsetWidth;
    const containerHeight = bracketContainer.offsetHeight;

    if (containerWidth === 0 || containerHeight === 0) {
        return;
    }

    const allStaticTeams = document.querySelectorAll('.bracket-wrapper .team');
    allStaticTeams.forEach(teamEl => teamEl.classList.remove('picked'));

    $('select.form-selector').each(function () {
        const selectedOption = $(this).find('option:selected');
        const value = $(this).val();

        if (value && selectedOption.length > 0 && selectedOption.data('seed') !== undefined) {
            const seed = parseInt(selectedOption.data('seed'));
            const regionName = selectedOption.data('region');

            const regionArrayIndex = regionData.indexOf(regionName);

            if (regionArrayIndex !== -1) {
                const targetDataRegionValue = regionArrayIndex + 1;
                const elementsToPick = document.querySelectorAll(`.team[data-region="${targetDataRegionValue}"][data-seed="${seed}"]`);
                elementsToPick.forEach(el => el.classList.add('picked'));
            } else {
                console.warn(`Region name "${regionName}" not found in regionData. Cannot highlight team in static bracket.`);
            }
        }
    });
}

function adjustR3MatchupMargins() {
    const roundR3Elements = document.querySelectorAll('.bracket-wrapper .round.r3');

    roundR3Elements.forEach(roundElement => {
        const parentHeight = roundElement.offsetHeight;
        if (parentHeight > 0) {
            const marginValue = parentHeight * 0.06;
            const matchupElements = roundElement.querySelectorAll('.matchup');
            matchupElements[0].style.marginTop = `${marginValue}px`;
            matchupElements[1].style.marginBottom = `${marginValue}px`;
            matchupElements[2].style.marginTop = `${marginValue}px`;
            matchupElements[3].style.marginBottom = `${marginValue}px`;
        }
    });

    const roundR4Elements = document.querySelectorAll('.bracket-wrapper .round.r4');

    roundR4Elements.forEach(roundElement => {
        const parentHeight2 = roundElement.offsetHeight;
        if (parentHeight2 > 0) {
            const marginValue2 = parentHeight2 * 0.125;
            const matchupElements2 = roundElement.querySelectorAll('.matchup');
            matchupElements2[0].style.marginTop = `${marginValue2}px`;
            matchupElements2[2].style.marginBottom = `${marginValue2}px`;
        }
    });
}

function adjustTeamNameFontSize() {
    const teamNameSpans = document.querySelectorAll('#bracketRow .round.r1 .team span.name');

    teamNameSpans.forEach(span => {
        span.style.fontSize = '';
        const parentTeamElement = span.parentElement;
        if (span.dataset.fullName && span.textContent !== span.dataset.fullName) {
            span.textContent = span.dataset.fullName;
        }

        if (span.scrollHeight > parentTeamElement.clientHeight + 6) {
            if (span.dataset.mascotName && span.textContent === span.dataset.fullName) {
                span.textContent = span.dataset.mascotName;
            }
        }
    });
}

const debouncedAdjustR3MatchupMargins = debounce(adjustR3MatchupMargins, 150);
const debouncedAdjustTeamNameFontSize = debounce(adjustTeamNameFontSize, 150);

async function fetchAndUpdateMaxPoints(selectedTeamValues) {
    const maxPointsSpan = document.getElementById('maxPoints');
    const maxPointsHiddenInput = document.getElementById('maxPointsHidden');
    if (!maxPointsSpan || !maxPointsHiddenInput) return;

    maxPointsSpan.textContent = "Calculating...";
    maxPointsHiddenInput.value = "0";

    const selectedTeamSIDs = selectedTeamValues.map(value => value.split(',')[0].trim());

    try {
        const response = await fetch('/calculateMaxPoints', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
            body: JSON.stringify({ teamSIDs: selectedTeamSIDs }),
        });

        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }

        const maxPointsData = await response.json();

        if (maxPointsData.data.maxPoints) {
            maxPointsSpan.textContent = maxPointsData.data.maxPoints;
            maxPointsHiddenInput.value = maxPointsData.data.maxPoints;
        } else {
            console.warn("Received invalid data format for max points:", maxPointsData);
            maxPointsSpan.textContent = "Error";
            maxPointsHiddenInput.value = "0";
        }

    } catch (error) {
        console.error("Error fetching max possible points:", error);
        maxPointsSpan.textContent = "Error";
        maxPointsHiddenInput.value = "0";
    }
}

async function initializeFormState() {
    setTimeout(async () => {
        // Pre-populate dropdowns from saved entry data
        $('select.form-selector').each(function (index) {
            const selectElement = $(this);
            if (index < entryPicksFromServer.length) {
                const targetSID = String(entryPicksFromServer[index]);
                let foundOptionValue = null;

                selectElement.find('option').each(function () {
                    const optionVal = $(this).val();
                    if (optionVal && String(optionVal).startsWith(targetSID + ',')) {
                        foundOptionValue = optionVal;
                        return false;
                    }
                });

                if (foundOptionValue) {
                    selectElement.val(foundOptionValue);
                } else {
                    console.warn(`Dropdown ${selectElement.attr('id')}: No option found for sID ${targetSID}. Pick index: ${index}.`);
                }
            }
        });

        const selectedTeamsMap = new Map();
        $('select.form-selector').each(function () {
            const selectedValue = $(this).val();
            if (selectedValue && selectedValue !== "") {
                selectedTeamsMap.set(selectedValue, this);
            }
        });

        $('select.form-selector').each(function () {
            const currentSelect = this;
            $(this).children('option').each(function () {
                const optionValue = $(this).val();
                if (optionValue && optionValue !== "") {
                    if (selectedTeamsMap.has(optionValue) && selectedTeamsMap.get(optionValue) !== currentSelect) {
                        $(this).prop('disabled', true);
                    } else {
                        $(this).prop('disabled', false);
                    }
                }
            });
        });

        updateBracketVisual();

        const selectedValuesArray = Array.from(selectedTeamsMap.keys());
        if (selectedValuesArray.length === 10) {
            await fetchAndUpdateMaxPoints(selectedValuesArray);
        } else {
            const maxPointsSpan = document.getElementById('maxPoints');
            if (maxPointsSpan) {
                maxPointsSpan.textContent = "--";
            }
        }
    }, 0);
}

function disableAndChangeText(button) {
    button.disabled = true;
    button.textContent = "Submitting...";
    setTimeout(function () {
        button.form.submit();
    }, 10);
}

$(document).ready(function () {
    // --- Populate R1 team names on initial load ---
    const r1TeamSlots = document.querySelectorAll('.bracket-wrapper .team[data-round="1"]');
    r1TeamSlots.forEach(slot => {
        const seed = parseInt(slot.dataset.seed);
        const dataRegion = parseInt(slot.dataset.region);

        if (dataRegion >= 1 && dataRegion <= regionData.length) {
            const regionName = regionData[dataRegion - 1];
            const teamInfo = teamData.find(t => t.seed === seed && t.regionName === regionName);

            if (teamInfo) {
                const nameSpan = slot.querySelector('span.name');
                if (nameSpan) {
                    const fullName = `${teamInfo.seed}. ${teamInfo.nameNick} ${teamInfo.mascot}`;
                    const mascotName = `${teamInfo.seed}. ${teamInfo.mascot}`;
                    nameSpan.textContent = fullName;
                    nameSpan.dataset.fullName = fullName;
                    nameSpan.dataset.mascotName = mascotName;
                }
            }
        }
    });

    adjustTeamNameFontSize();
    adjustR3MatchupMargins();
    updateBracketVisual();

    // Attach change event handlers to each dropdown
    $('select.form-selector').change(function () {
        const selectedTeamsMap = new Map();
        $('select.form-selector').each(function () {
            const selectedValue = $(this).val();
            if (selectedValue) {
                selectedTeamsMap.set(selectedValue, this);
            }
        });

        // Disable already-selected options in other dropdowns
        $('select.form-selector').each(function () {
            const currentSelect = this;
            $(this).children('option').each(function () {
                const optionValue = $(this).val();
                if (optionValue && selectedTeamsMap.has(optionValue) && selectedTeamsMap.get(optionValue) !== currentSelect) {
                    $(this).prop('disabled', true);
                } else {
                    $(this).prop('disabled', false);
                }
            });
        });

        updateBracketVisual();
        adjustR3MatchupMargins();

        const maxPointsSpan = document.getElementById('maxPoints');
        const selectedValuesArray = Array.from(selectedTeamsMap.keys());

        if (selectedValuesArray.length === 10) {
            fetchAndUpdateMaxPoints(selectedValuesArray);
        } else {
            if (maxPointsSpan) {
                maxPointsSpan.textContent = "--";
            }
        }
    });

    // --- Resize listener ---
    $(window).on('resize', function () {
        debouncedAdjustR3MatchupMargins();
        debouncedAdjustTeamNameFontSize();
    });

    $('form').submit(function (event) {
        if (!this.checkValidity()) {
            return;
        }

        event.preventDefault();

        const selectedTeams = new Set();
        let hasDuplicates = false;

        $('select.form-selector').each(function () {
            const selectedValue = $(this).val();
            if (selectedValue && selectedTeams.has(selectedValue)) {
                hasDuplicates = true;
                return false;
            }
            selectedTeams.add(selectedValue);
        });

        if (hasDuplicates) {
            alert("You can't pick the same team twice!");
            return false;
        }
        if (selectedTeams.size != 10) {
            alert("Please pick 10 teams. If this is an error report it to your group admin");
            return false;
        }

        disableAndChangeText(event.target.querySelector('button[type="submit"]'));
    });

    initializeFormState();
});
