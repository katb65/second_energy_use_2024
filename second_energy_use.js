// ---Goal: ---
// By state (or whole US) & year, show breakdown of energy sources for that area, by electric sector vs primary, with fuel breakdown of primary.
// Also show, separately, CO2 emissions responsibility of each of these pieces. Pin focus on primary non-green subparts, which should be made green
// or electrified to move towards fewer emissions. No splits for electricity fuel sources exist in this visualization: they can be found in the earlier
// one with them as its focus.
  
// ---Assumptions: ---
// Location of link to query will remain the same (put separate links to use into individual SectorSubset objects if this changes)
// Acronyms will remain the same (change if changes)
// IDs will remain singular per subcategory (can change to array format in the SectorSubsets if this changes)
// Years which have US vals for all sectors will also have other state vals for all sectors
// If null ID, that subvalue is 0 (ex. for energy sources for primary energy - like wind residential power)
// If primary exists for a certain year in API, its pieces do too (re: year checking)
// Response length won't exceed allowed amount, else years will truncate

// ---These should be changed to someone else's EIA API key & directory root (for local files) once I'm not involved with the project: ---
// (key obtainable on EIA site):
let eiaKey = "QL5ASXTSN9ccXzVu4Ly6UKwc0Fkj4AyKuDVs1dEX";
let directoryRoot = ""; // if this is blank, doesn't seem to trigger CORS due to same origin: 
// if using full root name, may need to update server CORS policy to allow

// -----------------------------------------------------
// ---Helper Objects: ---
// -----------------------------------------------------

// These add together to the primary total for their sector, used to give more detail into it (its energy use & CO2 emissions)
class PrimaryPiece {
  key; // ex. "wind"
  idToVal; // map to contain ID to val to add or subtract for state & US mappings for this piece, GWh
  // needs to be a map due to some pieces having multiple different things that need to be added or subtracted
  valState; // totaled val state of this piece
  valUS; // totaled val US of this piece

  // (ID for fuel is stored higher in the chain due to repetition)
  co2State; // co2, state, of this piece, million metric tons
  co2US; // co2, US, of this piece, million metric tons

  // add means add together, sub means subtract from these, all to get final total for primary
  // b/c some vals come with caveats (ex. natural gas needs supplemental fuels subtracted)
  constructor(key, idsEnergyAdd, idsEnergySub) {
    this.idToVal = new Map();

    this.key = key;
    for(let id of idsEnergyAdd) {
      this.idToVal.set(id, {valState: null, valUS: null, add: true});
    }
    for(let id of idsEnergySub) {
      this.idToVal.set(id, {valState: null, valUS: null, add: false});
    }

    this.valState = null;
    this.valUS = null;
    this.co2State = null;
    this.co2US = null;
  }
}

// To aid in SectorSubset mapping mechanics, holds one of the pieces that a sector subset is divided into (its name, ids, and values for US & current-set state
// for current-set year)
// IDs may pull in different units than stored; are converted in pull method if so
// A sector subset is divided into 3 main pieces: elecSector, primary, and total, where elecSector + primary = total,
// elecSector = electricity this sector consumes from the electric sector (post-production losses, not inc them - ex. coal's inefficiency disregarded)
// primary = total primary energy this sector consumes (not from elecSector)
// total = this sector's total consumption (for the set year, not inc. "electrical system energy losses") = elecSector + primary
// co2 vals correspond to the amount of CO2 this sub-subset is responsible for in current-set year & state/US
// primary energy SubSubsets are further divided using inner map
// null or 0 for any value means not present in EIA data (assumed 0)
class SubSubset {
  key; // ex. "elecSector"
  idEnergy; // ex. "ESCCB" for a commercial sector subset, elecSector sub subset
  idSectorCO2; // ex. "RC" for residential sector subset primary, or "EC" for electric sector subset (electric is to be split into proportional parts for each sector)
  valState; // GWh
  valUS; // GWh
  co2State; // million metric tons
  co2US; // million metric tons

  primaryPieces; // only non-null in primary SubSubsets, contains breakdown of primary energy by map of id to energy from that id, values in GWh
                 // and another ID & value per primary piece that stores CO2 for that primary piece + how to access it
                 // (technically we could split electric data too, for both energy & CO2, but the focus here is more on the primary parts)

  constructor(key, idEnergy, idSectorCO2) {
    this.key = key;
    this.idEnergy = idEnergy;
    this.idSectorCO2 = idSectorCO2;
    this.valState = null;
    this.valUS = null;
    this.co2State = null;
    this.co2US = null;
    this.primaryPieces = null;
  }

  setupPrimaryPieces(idWind, idSolar, idGeo, idHydro, idCoal, idNatGas, idSuppGas, idPetroleum) { // all nuclear goes to elec. power sector, so not here
    this.primaryPieces = new Map();

    // adding pieces in the right order to maintain correct behavior elsewhere
    this.primaryPieces.set("wind", new PrimaryPiece("wind", [idWind], [])); 
    this.primaryPieces.set("solar", new PrimaryPiece("solar", [idSolar], []));
    this.primaryPieces.set("geothermal", new PrimaryPiece("geothermal", [idGeo], []));
    this.primaryPieces.set("hydroelectric", new PrimaryPiece("hydroelectric", [idHydro], []));

    this.primaryPieces.set("coal", new PrimaryPiece("coal", [idCoal], []));
    this.primaryPieces.set("natural gas", new PrimaryPiece("natural gas", [idNatGas], [idSuppGas])); // subtracting supplemental as per glossary for primary
    this.primaryPieces.set("petroleum", new PrimaryPiece("petroleum", [idPetroleum], []));

    this.primaryPieces.set("other", new PrimaryPiece("other", [], [])); // derived from primary total
  }
}

// To store subsets of energy consumption data per sector type in separate objects
// Its own mapping key is stored inside again since the object needs to be independently functional (like for treemap display)
class SectorSubset {
  key; // the sector type (ex. "commercial")

  // Map of sub subset names, to IDs used to index into EIA and curr state & US vals for curr year for that ID
  subSubsets;

  constructor(key, idElecSector, idTotal, 
              idWind, idSolar, idGeo, idHydro,
              idCoal, idNatGas, idSuppGas, idPetroleum,
              idSectorCO2) {
      this.key = key;

      this.subSubsets = new Map();
      this.subSubsets.set("elecSector", new SubSubset("elecSector", idElecSector, null)); // id for elec sector stored higher up due to need to divide
      this.subSubsets.set("primary", new SubSubset("primary", null, idSectorCO2));
      this.subSubsets.set("total", new SubSubset("total", idTotal, null));

      this.subSubsets.get("primary").setupPrimaryPieces(idWind, idSolar, idGeo, idHydro,
                                                        idCoal, idNatGas, idSuppGas, idPetroleum);
  }
}

// -----------------------------------------------------
// ---Inner Variables: ---
// -----------------------------------------------------
// Selected state or entire US, default to US (used to initialize some US-wide data at start) and changed by user with dropdown menu 
let state = "US";

// Year of data 
// Initialized to latest year, changed by user with dropdown 
let year = null;

// Store CO2 IDs that are repeatedly used outside + overall ids and values map (map inside is subset key -> FuelSubset object)
// IDs pull energy in Billion BTU, need conversion (CO2 emissions have correct unit)
// (CO2 ID storing outside makes them harder to store when pulling but gives less redundancy during query formulation)
let sectorsCons = {idAllFuelCO2: "TO", idElecSectorCO2: "EC", idCoalCO2: "CO", idNatGasCO2: "NG", idPetroleumCO2: "PE", subsetsMap: new Map()};

// using end-use, not net, for total (net was too small, primary parts overflowed); so we can't pull primary (similar process subtractions in it as in net), 
// we must subtract electric to get it
sectorsCons.subsetsMap.set("residential", new SectorSubset("residential", "ESRCB", "TNRCB",
                                                  null, "SORCB", "GERCB", null,
                                                  "CLRCB", "NGRCB", "SFRCB", "PARCB",
                                                  "RC"));
sectorsCons.subsetsMap.set("commercial", new SectorSubset("commercial", "ESCCB", "TNCCB",
                                                "WYCCB", "SOCCB", "GECCB", "HYCCB",
                                                "CLCCB", "NGCCB", "SFCCB", "PACCB",
                                                "CC"));
// the ID is slightly different for industrial electricity than the others: it's "excluding refinery use" - hence "ESISB", not "ESICB" (the latter doesn't add up)
sectorsCons.subsetsMap.set("industrial", new SectorSubset("industrial", "ESISB", "TNICB",
                                                "WYICB", "SOICB", "GEICB", "HYICB",
                                                "CLICB", "NGICB", "SFINB", "PAICB",
                                                "IC"));
// NGASB not NGACB for transportation's natural gas (there's no supplemental fuels to subtract out by ID here)
sectorsCons.subsetsMap.set("transportation", new SectorSubset("transportation", "ESACB", "TNACB",
                                                    null, null, null, null,
                                                    "CLACB", "NGASB", null, "PAACB",
                                                    "TC"));

// State name to ID mapping (for HTML dropdown)
let stateNameToID = new Map();

// -----------------------------------------------------
// ---Display Variables: ---
// -----------------------------------------------------

// To add commas to delimit 000 in numbers and keep the 2 decimal points
let formatCommas = d3.format(",.2f");

// Define colors 
let colorMap = new Map();

colorMap.set("residential", d3.interpolateRgb("rgb(255, 239, 204)", "rgb(230,159,0)"));
colorMap.set("commercial", d3.interpolateRgb("rgb(255, 222, 173)", "rgb(180,109,0)"));
colorMap.set("industrial", d3.interpolateRgb("rgb(200, 200, 200)", "rgb(0, 0, 0)"));
colorMap.set("transportation", d3.interpolateRgb("rgb(207, 239, 255)", "rgb(86, 180, 233)"));

// Whether to display energy data in GW or GWh (one is more intuitive to renewable energy formats, the other to
// consumable energy formats; adjusted with user's selection)
let GWhorGW = "GWh";

// -----------------------------------------------------
// ---HTML Element Adjustments: ---
// -----------------------------------------------------
// Elements start out locked & are unlocked after initialization (relocked with each data fetch)

d3.select("#state-select-drop")
  .on("change", updateState);

d3.select("#year-select-drop")
  .on("change", updateYear);

d3.select("#GWh-or-GW-drop")
  .on("change", updateGWhorGW);

// -----------------------------------------------------
// ---On-Change Functions: ---
// -----------------------------------------------------

// Called on user change of state selection, changes state variable then 
// locks user input, updates inner data & its text & vis output, unlocks user input
async function updateState() {
    state = d3.select("#state-select-drop").property("value");

    disableUserInput();

    await pullStoreStateData();

    visualizeStateData(); 

    enableUserInput();
}

// Called on user change of year selection, changes year variable then
// locks user input, updates inner data & its text & vis output, unlocks user input
async function updateYear() {
    year = parseInt(d3.select("#year-select-drop").property("value"));

    disableUserInput();

    await pullStoreUSData();
    if(state === "US") {
      copyUSToStateData();
    } else {
      await pullStoreStateData();
    }

    visualizeStateData();

    enableUserInput();
}

// Called on user change of GW vs GWh display selection, changes GWhorGW and updates text output
function updateGWhorGW() {
  GWhorGW = d3.select("#GWh-or-GW-drop").property("value");

  visualizeStateData();
}

// -----------------------------------------------------
// ---Main Functions: ---
// -----------------------------------------------------

// Sets up year dropdown + state-specific and US-wide variables & text through initial data pull & unlocks the user input
// NOTE: assumes user input is locked in the process
async function initialize() {
    // Pull everything for US to initialize
    initializeStateNameToID();
    initializeStateSelect();
    await initializeYears();

    await pullStoreUSData();
    if(state === "US") {
      copyUSToStateData();
    } else {
      await pullStoreStateData();
    }

    visualizeStateData();

    enableUserInput();
}

// Generate user input dropdown for state selection based on our state name -> state ID mapping
// NOTE: assumes user input is locked in the process; and does not unlock it (needs an outer layer function to do so)
function initializeStateSelect() {
    let stateSelectDrop = d3.select("#state-select-drop");
    
    let stateNames = [];
    stateNames.push("Entire US");
    let stateNamesIterator = stateNameToID.keys();
    for(let currStateNameI = stateNamesIterator.next(); !currStateNameI.done; currStateNameI = stateNamesIterator.next()) {
      let currStateName = currStateNameI.value;
      stateNames.push(currStateName);
    }
  
    stateSelectDrop.selectAll("option")
    .data(stateNames)
    .join("option")
    .property("value", (d) => {
      if(d == "Entire US") {
        return "US";
      } else {
        return stateNameToID.get(d);
      }
    })
    .text(d=>d);
}

// Acquire info about all years available in energy & CO2 data & generate user input dropdown based on it
// + set initial year
// NOTE: assumes user input is locked in the process; and does not unlock it (needs an outer layer function to do so)
async function initializeYears() {
  // can't use metadata: it gives only full date range (largest range), not range when all vals needed are available

  // count large-scale ids (4*2 for energy, 4*1 + 1 for CO2)
  let idCount = sectorsCons.subsetsMap.size * 2 + sectorsCons.subsetsMap.size * 1 + 1;

  allYearFullsEnergyPromise = d3.json(composeQueryString("energy", null, "US", null, null));
  allYearFullsCO2Promise = d3.json(composeQueryString("CO2", null, "US", null, null))
  allYearFullsEnergy = await allYearFullsEnergyPromise;
  allYearFullsCO2 = await allYearFullsCO2Promise;

  yearsContained = new Map();

  // map each year to the series ids that have values for it
  for(let currFull of allYearFullsEnergy.response.data) {
    let currYear = parseInt(currFull.period);

    if(!yearsContained.has(currYear)) {
      yearsContained.set(currYear, new Set());
    }

    yearsContained.get(currYear).add(currFull.seriesId);
  }
  for(let currFull of allYearFullsCO2.response.data) {
    let currYear = parseInt(currFull.period);

    // if year not contained yet in map, already know it's not in the energy pull, so it'd be eliminated
    // at the end anyway
    if(yearsContained.has(currYear)) {
      yearsContained.get(currYear).add(currFull.sectorId);
    }
  }

  // only add to options those years which have values for all ids queried
  let years = [];
  for(let currYear of yearsContained.keys()) {
    if(yearsContained.get(currYear).size == idCount) {
      years.push(currYear);
    }
  }

  // initialize the HTML element with available years
  let yearSelectDrop = d3.select("#year-select-drop");

  yearSelectDrop.selectAll("option")
  .data(years)
  .join("option")
  .property("value", d=>d)
  .text(d=>d);

  year = years[0]; // will be latest year, due to sorting of request & JavaScript map key ordering mechanics
}

// Acquire per-sector fuel consumption info for US for current-set year and store in the US parts of the SectorSubsets
// NOTE: assumes user input is locked in the process; and does not unlock it (needs an outer layer function to do so)
async function pullStoreUSData() {
  // workflow: pull entire API call at once per EIA browser type, then go through values and sift them into the corresponding object spaces
  // then check that it approx. sums to total for each one, and throw error if not
  // way faster than multiple API calls

  // query for query strings & await Promise resolution
  let allFullsEnergyPromise = d3.json(composeQueryString("energy", "value", "US", (year-1), (year+1)));
  let allFullsCO2Promise = d3.json(composeQueryString("CO2", "value", "US", (year-1), (year+1)));
  let allFullsEnergy = await allFullsEnergyPromise;
  let allFullsCO2 = await allFullsCO2Promise;

  storeSectorData(allFullsEnergy, allFullsCO2, "US", "US");

  checkTotalParts("US");
}

// Acquire per-sector fuel consumption info for current-set state & year and store in the state parts of the SectorSubsets
// NOTE: assumes user input is locked in the process; and does not unlock it (needs an outer layer function to do so)
async function pullStoreStateData() {
  // query for query strings & await Promise resolution
  let allFullsEnergyPromise = d3.json(composeQueryString("energy", "value", state, (year-1), (year+1)));
  let allFullsCO2Promise = d3.json(composeQueryString("CO2", "value", state, (year-1), (year+1)));
  let allFullsEnergy = await allFullsEnergyPromise;
  let allFullsCO2 = await allFullsCO2Promise;

  storeSectorData(allFullsEnergy, allFullsCO2, "state", state);

  checkTotalParts("state");
}

// If the state selected is US, copy data rather than pulling again
function copyUSToStateData() {
  // Set all state vals as 0 to avoid leftover prior values in case of data gaps
  for(let currSubset of sectorsCons.subsetsMap.values()) {
    for(let currSubSubset of currSubset.subSubsets.values()) {
      currSubSubset.valState = 0;
      currSubSubset.co2State = 0;
    }

    for(let currPrimaryPiece of currSubset.subSubsets.get("primary").primaryPieces.values()) {
      currPrimaryPiece.valState = 0;
      currPrimaryPiece.co2State = 0;

      for(let currVal of currPrimaryPiece.idToVal.values()) {
        currVal.valState = 0;
      }
    }
  }

  for(let currSubset of sectorsCons.subsetsMap.values()) {
    for(let currSubSubset of currSubset.subSubsets.values()) {
      currSubSubset.valState = currSubSubset.valUS;
      currSubSubset.co2State = currSubSubset.co2US;
      if(currSubSubset.primaryPieces !== null) {
        for(let currPrimaryPiece of currSubSubset.primaryPieces.values()) {
          currPrimaryPiece.valState = currPrimaryPiece.valUS;
          currPrimaryPiece.co2State = currPrimaryPiece.co2US;
          for(let currVal of currPrimaryPiece.idToVal.values()) {
            currVal.valState = currVal.valUS;
          }
        }
      }
    }
  }

  // no need to run the check function again, these are the same values
}

// Print titles & treemap visualizations for state data, with included US data comparison pieces
function visualizeStateData() {
  // Set up treemap structures from our stored data that D3 can use in its functions
  let currRootEnergy = setupTreemap("energy");
  let currRootCO2 = setupTreemap("CO2");

  // Print titles
  d3.select("#energy-title-text")
  .text("Energy in " + state + " in " + year + ":");

  d3.select("#co2-title-text")
    .text("CO2* in " + state + " in " + year + ":");

  d3.select("#energy-legend-title-text")
    .text("Energy, " + GWhorGW);

  d3.select("#co2-legend-title-text")
    .text("CO2, Million Metric Tons");
    
  // Now we can make rect elements of these nodes & append them to an svg element on the screen
  var currSVGEnergy = d3.select("#energy-vis-state-tree");
  var currSVGCO2 = d3.select("#co2-vis-state-tree");
  printVis(currRootEnergy, currSVGEnergy, d3.select("#tooltip-energy"), "energy");
  printVis(currRootCO2, currSVGCO2, d3.select("#tooltip-co2"), "CO2");
}

// -----------------------------------------------------
// ---Helper Functions: ---
// -----------------------------------------------------
// (functions used for pieces of larger-function tasks, or repeated tasks, for clarity of reading)

// For initialize()
// Make the state to ID mappings
function initializeStateNameToID() {
    stateNameToID.set("Alabama", "AL").set("Alaska", "AK").set("Arizona", "AZ").set("Arkansas", "AR").set("California", "CA").set("Colorado", "CO")
    .set("Connecticut", "CT").set("D.C.", "DC").set("Delaware", "DE").set("Florida", "FL").set("Georgia", "GA").set("Hawaii", "HI").set("Idaho", "ID").set("Illinois", "IL")
    .set("Indiana", "IN").set("Iowa", "IA").set("Kansas", "KS").set("Kentucky", "KY").set("Louisiana", "LA").set("Maine", "ME").set("Maryland", "MD")
    .set("Massachusetts", "MA").set("Michigan", "MI").set("Minnesota", "MN").set("Mississippi", "MS").set("Missouri", "MO").set("Montana", "MT").set("Nebraska", "NE")
    .set("Nevada", "NV").set("New Hampshire", "NH").set("New Jersey", "NJ").set("New Mexico", "NM").set("New York", "NY").set("North Carolina", "NC")
    .set("North Dakota", "ND").set("Ohio", "OH").set("Oklahoma", "OK").set("Oregon", "OR").set("Pennsylvania", "PA").set("Rhode Island", "RI")
    .set("South Carolina", "SC").set("South Dakota", "SD").set("Tennessee", "TN").set("Texas", "TX").set("Utah", "UT").set("Vermont", "VT").set("Virginia", "VA")
    .set("Washington", "WA").set("West Virginia", "WV").set("Wisconsin", "WI").set("Wyoming", "WY");
}

// For updateState(), updateYear()
// Disables all user input elements
function disableUserInput() {
  d3.select("#state-select-drop")
  .property("disabled", true);
  d3.select("#year-select-drop")
  .property("disabled", true);
  d3.select("#GWh-or-GW-drop")
  .property("disabled", true);
}

// For initialize(), updateState(), updateYear()
// Enables all user input elements
function enableUserInput() {
  d3.select("#state-select-drop")
  .attr("disabled", null);
  d3.select("#year-select-drop")
  .attr("disabled", null);
  d3.select("#GWh-or-GW-drop")
  .attr("disabled", null);
}

// For initializeYears(), pullStoreUSData(), pullStoreStateData()
// Composes an EIA energy or CO2 data query string with optional query, stateId, start, and end dates, 
// with current EIA API key and instructions to return annually & sort returned data by date in descending order
// (primary pieces are skipped in case of null query - used for year initialization)
function composeQueryString(energyOrCO2, query, stateId, start, end) {

  let allQueryString = "";

  if(energyOrCO2 === "energy") {
    allQueryString = "https://api.eia.gov/v2/seds/data/?";
  } else {
    allQueryString = "https://api.eia.gov/v2/co2-emissions/co2-emissions-aggregates/data/?"
  }

  allQueryString = allQueryString + "api_key=" + eiaKey + "&frequency=annual" + 
    "&sort[0][column]=period&sort[0][direction]=desc&offset=0";

  if(query !== null) {
    allQueryString += ("&data[0]=" + query);
  }
  if(stateId !== null) {
    allQueryString += ("&facets[stateId][]=" + stateId);
  }
  if(start !== null) {
    allQueryString += ("&start=" + start);
  }
  if(end !== null) {
    allQueryString += ("&end=" + end);
  }

  // add every ID we need to query for to the string
  if(energyOrCO2 === "energy") {
    for(let currSubset of sectorsCons.subsetsMap.values()) {
      allQueryString += ("&facets[seriesId][]=" + currSubset.subSubsets.get("elecSector").idEnergy);
      allQueryString += ("&facets[seriesId][]=" + currSubset.subSubsets.get("total").idEnergy);

      if(query !== null) { // if we're not just years-initializing, query for the little pieces too
        for(let currPrimaryPiece of currSubset.subSubsets.get("primary").primaryPieces.values()) {
          for(let currID of currPrimaryPiece.idToVal.keys()) {
            if(currID !== null) {
              allQueryString += ("&facets[seriesId][]=" + currID);
            }
          }
        }
      }
    }
  } else {
    allQueryString += ("&facets[fuelId][]=" + sectorsCons.idAllFuelCO2);
    allQueryString += ("&facets[sectorId][]=" + sectorsCons.idElecSectorCO2);

    for(let currSubset of sectorsCons.subsetsMap.values()) {
      allQueryString += ("&facets[sectorId][]=" + currSubset.subSubsets.get("primary").idSectorCO2);
    }

    if(query !== null) {
      allQueryString += ("&facets[fuelId][]=" + sectorsCons.idCoalCO2);
      allQueryString += ("&facets[fuelId][]=" + sectorsCons.idNatGasCO2);
      allQueryString += ("&facets[fuelId][]=" + sectorsCons.idPetroleumCO2);
    }
  }

  return allQueryString;
}

// For pullStoreUSData(), pullStoreStateData()
// Dissects & stores EIA API response data for stateId in the state or US part of the values map for the current-set year
// Note that stateOrUS and stateId differ, in that stateId for this query may be US but we may still be storing the data in
// the state or the US section of the map/objects (depending on if actual set state is US or a diff state)
// If no data for some value, assumes it 0
function storeSectorData(allFullsEnergy, allFullsCO2, stateOrUS, stateId) {
  let accessVal;
  let accessCO2;
  if(stateOrUS === "state") {
    accessVal = "valState";
    accessCO2 = "co2State";
  } else {
    accessVal = "valUS";
    accessCO2 = "co2US";
  }

  // Set all state or US vals as 0 to avoid leftover prior values in case of data gaps
  for(let currSubset of sectorsCons.subsetsMap.values()) {
    for(let currSubSubset of currSubset.subSubsets.values()) {
      currSubSubset[accessVal] = 0;
      currSubSubset[accessCO2] = 0;
    }

    for(let currPrimaryPiece of currSubset.subSubsets.get("primary").primaryPieces.values()) {
      currPrimaryPiece[accessVal] = 0;
      currPrimaryPiece[accessCO2] = 0;

      for(let currVal of currPrimaryPiece.idToVal.values()) {
        currVal[accessVal] = 0;
      }
    }
  }

  // isolate the requested values from the energy response & store them in the right spots
  for(let currFullEnergy of allFullsEnergy.response.data) {
    if(parseInt(currFullEnergy.period) != year) {
      continue; // we fetched several years near current year due to variable API mechanics, so cycle past irrelevant ones
    }

    if(currFullEnergy.unit !== "Billion Btu" || currFullEnergy.stateId !== stateId) { // year & series ID already checked above or below
      throw new Error("Unexpected unit or state ID mismatch in pulled API data with " + currFullEnergy);
    }

    let postConvert;
    if(isNaN(parseFloat(currFullEnergy.value))) {
      postConvert = 0;
    } else {
      // convert response val from Billion Btu to GWh
      let preConvert = parseFloat(currFullEnergy.value);
      postConvert = preConvert * (1/3.412);
    }

    for(let currSubset of sectorsCons.subsetsMap.values()) {
      for(let currSubSubset of currSubset.subSubsets.values()) {
        if(currSubSubset.idEnergy === currFullEnergy.seriesId) {
          // store converted val in currSubSubset
          currSubSubset[accessVal] = postConvert;
        } else if(currSubSubset.key === "primary") { // or it might be an ID for one of the primary pieces
          for(let currPrimaryPiece of currSubSubset.primaryPieces.values()) {
            for(let currID of currPrimaryPiece.idToVal.keys()) {
              if(currID === currFullEnergy.seriesId) {
                currPrimaryPiece.idToVal.get(currID)[accessVal] = postConvert;
              }
            }
          }
        }
      }
    }
  }

  // isolate the requested values from the CO2 response & store them in the right spots
  for(let currFullCO2 of allFullsCO2.response.data) {
    if(parseInt(currFullCO2.period) != year) {
      continue; // we fetched several years near current year due to variable API mechanics, so cycle past irrelevant ones
    }

    if(currFullCO2["value-units"] !== "million metric tons of CO2" || currFullCO2.stateId !== stateId) { // year & sector ID already checked
      throw new Error("Unexpected unit or state ID mismatch in pulled API data with " + currFullCO2 + " units " + currFullCO2["value-units"]);
    }

    if(currFullCO2.sectorId === sectorsCons.idElecSectorCO2 && currFullCO2.fuelId === sectorsCons.idAllFuelCO2) {
      // if this is the electric sector val, it needs to be split proportionally & stored in all the elecSector sub-subsets in pieces

      let postConvert;
      if(isNaN(parseFloat(currFullCO2.value))) {
        postConvert = 0;
      } else {
        // read in response val
        postConvert = parseFloat(currFullCO2.value);
      }

      let residentialElec = sectorsCons.subsetsMap.get("residential").subSubsets.get("elecSector");
      let commercialElec = sectorsCons.subsetsMap.get("commercial").subSubsets.get("elecSector");
      let industrialElec = sectorsCons.subsetsMap.get("industrial").subSubsets.get("elecSector");
      let transportationElec = sectorsCons.subsetsMap.get("transportation").subSubsets.get("elecSector");
      
      if(stateOrUS === "state") {
        let electricTotal = commercialElec.valState + industrialElec.valState + transportationElec.valState + residentialElec.valState;

        residentialElec.co2State = postConvert * (residentialElec.valState/electricTotal);
        commercialElec.co2State = postConvert * (commercialElec.valState/electricTotal);
        industrialElec.co2State = postConvert * (industrialElec.valState/electricTotal);
        transportationElec.co2State = postConvert * (transportationElec.valState/electricTotal);
      } else {
        let electricTotal = commercialElec.valUS + industrialElec.valUS + transportationElec.valUS + residentialElec.valUS;

        residentialElec.co2US = postConvert * (residentialElec.valUS/electricTotal);
        commercialElec.co2US = postConvert * (commercialElec.valUS/electricTotal);
        industrialElec.co2US = postConvert * (industrialElec.valUS/electricTotal);
        transportationElec.co2US = postConvert * (transportationElec.valUS/electricTotal);
      }
    } else { // not EC, so a primary sector's val or primary piece val, find the corresponding sector & its primary sub subset or that sub subset's correct piece
      for(let currSubset of sectorsCons.subsetsMap.values()) {
        for(let currSubSubset of currSubset.subSubsets.values()) {
          if(currSubSubset.idSectorCO2 === currFullCO2.sectorId) {

            let postConvert;
            if(isNaN(parseFloat(currFullCO2.value))) {
              postConvert = 0;
            } else {
              postConvert = parseFloat(currFullCO2.value);
            }

            if(currFullCO2.fuelId === sectorsCons.idAllFuelCO2) { // CO2 of all fuels for this sector  
              // store read-in val in currSubSubset
              currSubSubset[accessCO2] = postConvert;
            } else { // CO2 of some primary piece of fuel for this sector
              if(currFullCO2.fuelId === sectorsCons.idCoalCO2) {
                currSubSubset.primaryPieces.get("coal")[accessCO2] = postConvert;
              } else if (currFullCO2.fuelId === sectorsCons.idNatGasCO2) {
                currSubSubset.primaryPieces.get("natural gas")[accessCO2] = postConvert;
              } else if (currFullCO2.fuelId === sectorsCons.idPetroleumCO2) {
                currSubSubset.primaryPieces.get("petroleum")[accessCO2] = postConvert;
              }
            }
          }
        }
      }
    }
  }

  // sum and store the CO2 totals per sector as well (not directly pullable due to our proportioning of electric sector)
  // & derive the primary values and primary pieces inner totals and "other" (leftover of what was pulled)
  for(let currSubset of sectorsCons.subsetsMap.values()) {
    currSubset.subSubsets.get("total")[accessCO2] = currSubset.subSubsets.get("elecSector")[accessCO2] + currSubset.subSubsets.get("primary")[accessCO2];

    let currPrimary = currSubset.subSubsets.get("primary");
    currPrimary[accessVal] = currSubset.subSubsets.get("total")[accessVal] - currSubset.subSubsets.get("elecSector")[accessVal]; // calculate primary
    currPrimary.primaryPieces.get("other")[accessVal] = currPrimary[accessVal]; // start other's val with primary total val
    for(let currPrimaryPiece of currPrimary.primaryPieces.values()) {
      // valState or valUS was set to 0 at start of function
      for(let currVal of currPrimaryPiece.idToVal.values()) {
        if(currVal.add) { 
          currPrimaryPiece[accessVal] += currVal[accessVal];
        } else {
          currPrimaryPiece[accessVal] -= currVal[accessVal];
        }
      }

      if(currPrimaryPiece.key !== "other") {
        currPrimary.primaryPieces.get("other")[accessVal] -= currPrimaryPiece[accessVal];
      }
    }
  }
}

// For visualizeStateData()
// Sets up the treemap as usable for D3 visualization for energy or CO2
function setupTreemap(energyOrCO2) {
  // Make an object we can pass to D3's treemap function (making an object in JSON-esque format, then formatting it for treemap)
  // Skeleton: whole structure; to be added: the sector subsets, within them the elecSector & primary sub subsets
  let currName;
  let elecColorIdx;
  let primaryCleanColorIdx;
  let primaryNonCleanColorIdx;
  if(energyOrCO2 === "energy") {
    currName = "Energy Use In ";
    elecColorIdx = 0.4;
    primaryCleanColorIdx = 0.7;
    primaryNonCleanColorIdx = 1;
  } else {
    currName = "CO2 Emissions In ";
    elecColorIdx = 0;
    primaryCleanColorIdx = 0.1;
    primaryNonCleanColorIdx = 0.2;
  }

  let currJson = {
    name: currName + state + " By Sector & Primary/Electric",
    children: []
  }

  let accessValState;
  let accessValUS;
  if(energyOrCO2 === "energy") {
    accessValState = "valState";
    accessValUS = "valUS";
  } else {
    accessValState = "co2State"
    accessValUS = "co2US";
  }

  for(let currSubset of sectorsCons.subsetsMap.values()) {
    let currNameCap = currSubset.key.split(" ").map((s) => s.charAt(0).toUpperCase() + s.slice(1)).join(" ");
    let toAdd = {
      name: currNameCap,
      children: [
        {
          subset: currNameCap,
          subSubset: "Electric Sector",
          valState: currSubset.subSubsets.get("elecSector")[accessValState],
          valUS: currSubset.subSubsets.get("elecSector")[accessValUS],
          color: colorMap.get(currSubset.key)(elecColorIdx)
        },
        {
          subset: currNameCap,
          subSubset: "Primary",
          children: []
        }
      ]
    }

    for(let currPrimaryPiece of currSubset.subSubsets.get("primary").primaryPieces.values()) {
      let currPrimaryPieceNameCap = currPrimaryPiece.key.split(" ").map((s) => s.charAt(0).toUpperCase() + s.slice(1)).join(" ");
      let toAddPrimaryPiece = {
        subset: currNameCap,
        subSubset: "Primary",
        primaryPiece: currPrimaryPieceNameCap,
        valState: currPrimaryPiece[accessValState],
        valUS: currPrimaryPiece[accessValUS],
        color: null
      }

      if(currPrimaryPiece.key === "wind" || currPrimaryPiece.key === "solar" || currPrimaryPiece.key === "geothermal" || currPrimaryPiece.key === "hydroelectric") {
        toAddPrimaryPiece.color = colorMap.get(currSubset.key)(primaryCleanColorIdx);
      } else {
        toAddPrimaryPiece.color = colorMap.get(currSubset.key)(primaryNonCleanColorIdx);
      }

      toAdd.children[1].children.push(toAddPrimaryPiece);
    }

    currJson.children.push(toAdd);
  }

  let currHierarchy = d3.hierarchy(currJson) // adds depth, height, parent to the data
                        .sum((d) => d.valState)
                        .sort((a,b) => b.valState - a.valState); // sort in descending order

  // Set up the dimensions of a treemap, then pass the data to it
  let currTreemap = d3.treemap()
                      .tile(d3.treemapSliceDice) // make the subsections in logs rather than jumbled
                      .size([500,650])
                      .padding(1);
  let currRoot = currTreemap(currHierarchy); // determines & assigns x0, x1, y0, & y1 attrs for the data

  return currRoot;
}

// For visualizeStateData()
// Visualizes the passed root/treemap in the passed SVG and passed tooltip (for energy or CO2)
function printVis(currRoot, currSVG, currTooltip, energyOrCO2) {
  let units;
  if(energyOrCO2 === "energy") {
    if(GWhorGW === "GWh") {
      units = "GWh";
    } else {
      units = "GW";
    }
  } else {
    units = "Million Metric Tons";
  }

  currSVG.selectAll("rect")
          .data(currRoot.leaves().filter(d=>!("children" in d.data)))
          .join("rect")
          .attr("x", d=>d.x0)
          .attr("y", d=>d.y0)
          .attr("width", d=>d.x1-d.x0)
          .attr("height", d=>d.y1-d.y0)
          .attr("fill", d=>d.data.color)
          .on("mouseover", (event, d) => {

            currTooltip.style("visibility", "visible")
        
            currTooltip.select(".subset-name")
              .text(d.data.subset);
              
            let sliceName = d.data.subSubset;
            if("primaryPiece" in d.data) {
              sliceName += " " + d.data.primaryPiece;
            }
        
            currTooltip.select(".slice-name")
              .text(sliceName);
        
            let currVal;
            // only adjusting GWh display in the tooltip, not redrawing proportions of image by it, since it'd be approx same but with slight jitters
            // due to rounding errors
            if(energyOrCO2 === "CO2" || GWhorGW === "GWh") {
              currVal = formatCommas(d.data.valState.toFixed(2)); 
            } else {
              currVal = formatCommas((d.data.valState/(365*24)).toFixed(2));
            }
        
            currTooltip.select(".val")
              .text(currVal + " " + units);

            if(state === "US") {
              currTooltip.select(".percent")
                          .text("");
            } else {
              currTooltip.select(".percent")
                          .text((100*(d.data.valState/d.data.valUS)).toFixed(2) + "% of US");
            }
          })
          .on("mousemove", (event, d) => {
            let setXTo = event.pageX + 10 + "px";
            let setYTo = event.pageY - 10;
        
            if(event.pageY/window.innerHeight > 0.5) {
              // "Flip" tooltip if it's over halfway down the page
              let tooltipSize = d3.select("#tooltip-energy").property("clientHeight");
              setYTo -= tooltipSize;
            }
            setYTo += "px";
        
            currTooltip.style("top", setYTo)
              .style("left", setXTo);
          })
          .on("mouseout", (event, d) => {
            currTooltip.style("visibility", "hidden");
          }); 

  // Manual legend
  let divLeg;
  if(energyOrCO2 === "energy") {
    divLeg = d3.select("#energy-vis-state-legend");
  } else {
    divLeg = d3.select("#co2-vis-state-legend");
  }

  var size = 15; // of each color square for legend

  let currArr = [];
  for(currSubset of sectorsCons.subsetsMap.keys()) {
    currArr.push({"subset": currSubset, "leaves": currRoot.leaves().filter(d=>((!("children" in d.data))&&(d.data.subset.toLowerCase() === currSubset)&&(d.data.valState > 0)))});
  }

  divLeg.selectAll("svg")
  .data(currArr)
  .join("svg")
  .attr("width", parseInt(divLeg.style("width").slice(0, -2)))
  .attr("height", (d) => { return size*3.5 + size*d.leaves.length })
  .each(function(d,i){ // passes each existing svg's data down into itself to create squares & text
    d3.select(this).selectAll("rect")
      .data(d.leaves)
      .join("rect")
      .attr("x", 0)
      .attr("y", function(d,i){ return i*(size+2) + size*1.7 })
      .attr("width", size)
      .attr("height", size)
      .attr("fill", d=>d.data.color);

    d3.select(this).selectAll(".subtitles")
        .data([d.subset]) // the sector (wrap in array to avoid it treating string as char array)
        .join("text")
        .attr("class", "subtitles")
        .attr("x", 0)
        .attr("y", size*1.5)
        .text((d) => { return d.split(" ").map((s) => s.charAt(0).toUpperCase() + s.slice(1))});

    d3.select(this).selectAll(".leg-text-names") 
      .data(d.leaves) // its pieces (names, left-justified)
      .join("text")
      .attr("class", "leg-text-names")
      .attr("x", size*2)
      .attr("y", function(d,i){ return i*(size+2) + size*2.5 })
      .text((d) => {
        let sliceName = d.data.subSubset;
        if("primaryPiece" in d.data) {
          sliceName += " " + d.data.primaryPiece;
        }

        return sliceName;
      });

      d3.select(this).selectAll(".leg-text-vals") 
      .data(d.leaves) // its pieces (values, right-justified)
      .join("text")
      .attr("class", "leg-text-vals")
      .attr("x", parseInt(d3.select(this).style("width").slice(0, -2)) - size*2)
      .attr("y", function(d,i){ return i*(size+2) + size*2.5 })
      .attr("text-anchor", "end")
      .text((d) => {
        if(energyOrCO2 === "CO2" || GWhorGW === "GWh") {
          return formatCommas(d.data.valState.toFixed(2));
        } else {
          return formatCommas((d.data.valState/(365*24)).toFixed(2));
        }
      });
  });
}

// For pullStoreUSData(), pullStoreStateData()
// Checks that state or US parts of each SectorSubset sum to total for energy & CO2 (with slight margin of error)
// as well as the same for primaryPieces
// even though most are derived themselves by subtraction
function checkTotalParts(stateOrUS) {
  // sanity check the elecSector + primary = total (with margin of error)
  for(let currSubset of sectorsCons.subsetsMap.values()) {
    let accessVal;
    let accessCO2;
    if(stateOrUS === "state") {
      accessVal = "valState";
      accessCO2 = "co2State";
    } else {
      accessVal = "valUS";
      accessCO2 = "co2State";
    }

    let currElecSectorEnergy = currSubset.subSubsets.get("elecSector")[accessVal];
    let currPrimaryEnergy = currSubset.subSubsets.get("primary")[accessVal];
    let currTotalEnergy = currSubset.subSubsets.get("total")[accessVal];
    let currElecSectorCO2 = currSubset.subSubsets.get("elecSector")[accessCO2];
    let currPrimaryCO2 = currSubset.subSubsets.get("primary")[accessCO2];
    let currTotalCO2 = currSubset.subSubsets.get("total")[accessCO2];

    if(Math.abs(currElecSectorEnergy + currPrimaryEnergy - currTotalEnergy) > 100 ||
        Math.abs(currElecSectorCO2 + currPrimaryCO2 - currTotalCO2 > 0.01)) { // 100 GWh/0.01 mil metric tons for leeway with returned data or conversion 
      throw new Error ("elecSector and primary energy or CO2 don't sum to total in " + currSubset);
    }

    // may happen if we choose the wrong total to subtract primary pieces from to derive "other" & they overflow
    if(currSubset.subSubsets.get("primary").primaryPieces.get("other")[accessVal] < -100) { // 100 GWh leeway
      throw new Error ("other primary piece is negative in " + currSubset.key);
    }

    let currPrimaryCO2Sum = 0;
    let currPrimaryEnergySum = 0;
    for(let currPrimaryPiece of currSubset.subSubsets.get("primary").primaryPieces.values()) {
      currPrimaryCO2Sum += currPrimaryPiece[accessCO2];
      currPrimaryEnergySum += currPrimaryPiece[accessVal];
    }
    if(Math.abs(currPrimaryCO2 - currPrimaryCO2Sum) > 0.01 || Math.abs(currPrimaryEnergy - currPrimaryEnergySum) > 100) {
      throw new Error ("primary pieces of CO2 or energy don't sum to primary CO2 or energy total in " + currSubset);
    }
  }
}

// -----------------------------------------------------
// ---Initial: ---
// -----------------------------------------------------
initialize();