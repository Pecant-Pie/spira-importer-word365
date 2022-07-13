/*
 * Copyright (c) Microsoft Corporation. All rights reserved. Licensed under the MIT license.
 * See LICENSE in the project root for license information.
 */

/* global document, Office, Word */

/***********************
Initialization Functions
***********************/


import { Data, params, templates, ERROR_MESSAGES } from './model'
import {
  parseArtifacts,
  loginCall,
  retrieveStyles,
  updateSelectionArray
} from './server'

// Global selection array, used throughout
/*This is a global variable because the word API call functions are unable to return
values from within due to the required syntax of returning a Word.run((callback) =>{}) 
function. */
var model = new Data();
var SELECTION = [];
var versionSupport;
//setting a user object to maintain credentials when using other parts of the add-in

Office.onReady((info) => {
  if (info.host === Office.HostType.Word) {
    setDefaultDisplay();
    setEventListeners();
    document.body.classList.add('ms-office');
    //This checks if a users Word versions supports WordApi 1.3, then sets this in a global variable
    versionSupport = Office.context.requirements.isSetSupported("WordApi", "1.3")
    // this element doesn't currently exist
    // document.getElementById("help-connection-google").style.display = "none";
  }
});

const setDefaultDisplay = () => {
  document.getElementById("app-body").style.display = "flex";
}

const setEventListeners = () => {
  let states = params.pageStates;
  document.getElementById('test').onclick = () => test();
  document.getElementById('btn-login').onclick = async () => await loginAttempt();
  document.getElementById('dev-mode').onclick = () => goToState(states.dev);
  document.getElementById('send-to-spira-button').onclick = async () => await pushArtifacts();
  document.getElementById('log-out').onclick = () => goToState(states.authentication);
  document.getElementById("select-requirements").onclick = () => openStyleMappings("req-");
  document.getElementById("select-test-cases").onclick = () => openStyleMappings("test-");
  document.getElementById("confirm-req-style-mappings").onclick = () => confirmStyleMappings('req-');
  document.getElementById("confirm-test-style-mappings").onclick = () => confirmStyleMappings('test-');
  document.getElementById('project-select').onchange = () => goToState(states.artifact);
  document.getElementById("pop-up-close").onclick = () => hideElement("pop-up");
  document.getElementById("pop-up-ok").onclick = () => hideElement('pop-up');
  document.getElementById("btn-help-login").onclick = () => goToState(states.helpLogin);
  document.getElementById("btn-help-main").onclick = () => goToState(states.helpMain);
  document.getElementById(params.buttonIds.helpLogin).onclick = () => openHelpSection(params.buttonIds.helpLogin);
  document.getElementById(params.buttonIds.helpModes).onclick = () => openHelpSection(params.buttonIds.helpModes);
  document.getElementById(params.buttonIds.helpVersions).onclick = () => openHelpSection(params.buttonIds.helpVersions);
}

/****************
Testing Functions 
*****************/
//basic testing function for validating code snippet behaviour.
async function test() {
  return Word.run(async (context) => {
    let body = context.document.body
    context.load(body)
    await context.sync()
    let html = body.getHtml();
    await context.sync();
    console.log(html.m_value)
    await axios.post('http://localhost:3000/retrieve', {html: html.m_value})
  })
}

/**************
Spira API calls
**************/

// REFACTOR IN PROGRESS 
// Replaced USER_OBJ with the new model.user.(field) format
const loginAttempt = async () => {
  /*disable the login button to prevent someone from pressing it multiple times, this can
  overpopulate the products selector with duplicate sets.*/
  document.getElementById("btn-login").disabled = true
  //retrieves form data from input elements
  let url = document.getElementById("input-url").value
  let username = document.getElementById("input-username").value
  let rssToken = document.getElementById("input-password").value
  //allows user to enter URL with trailing slash or not.
  if (url[url.length - 1] == "/") {
    //url cannot be changed as it is tied to the HTML DOM input object, so creates a new variable
    var finalUrl = url.substring(0, url.length - 1)
  }
  //formatting the URL as it should be to populate products / validate user credentials
  let validatingURL = finalUrl || url + params.apiComponents.loginCall + `?username=${username}&api-key=${rssToken}`;
  try {
    //call the products API to populate relevant products
    var response = await loginCall(validatingURL);
    if (response.body) {
      //if successful response, move user to main screen
      hideElement('panel-auth');
      showElement('main-screen');
      document.getElementById('main-screen').style.display = 'flex';
      document.getElementById("btn-login").disabled = false
      model.user.url = finalUrl || url;
      model.user.username = username;
      model.user.api_key = rssToken;
      model.user.userCredentials = `?username=${username}&api-key=${rssToken}`;
      //populate the products dropdown & model object with the response body.
      populateProjects(response.body)
      //On successful login, hide error message if its visible
      clearErrors();
      return
    }
  }
  catch (err) {
    //if the response throws an error, show an error message
    displayError(ERROR_MESSAGES.login);
    document.getElementById("btn-login").disabled = false;
    return
  }
}

/********************
HTML DOM Manipulation
********************/

// these will be called for login and send to spira buttons
const disableButton = (htmlId) => {
  document.getElementById(htmlId).disabled = true
}

const enableButton = (htmlId) => {
  document.getElementById(htmlId).disabled = false
}

const disableMainButtons = () => { // Disables all buttons on the main screen
  let buttons = Object.values(params.buttonIds);
  for (let button of buttons) {
    disableButton(button);
  }
}

const enableMainButtons = () => { // Enables all buttons on the main screen
  let buttons = Object.values(params.buttonIds);
  for (let button of buttons) {
    enableButton(button);
  }
}

const populateProjects = (projects) => {
  addDefaultProject();
  model.projects = projects
  let dropdown = document.getElementById('project-select')
  projects.forEach((project) => {
    /*creates an option for each product which displays the name
     and has a value of its ProjectId for use in API calls*/
    let option = document.createElement("option");
    option.text = project.Name
    option.value = project.ProjectId
    dropdown.add(option)
  })
  return
}

const openStyleMappings = async (pageTag) => {
  //opens the requirements style mappings if requirements is the selected artifact type
  /*all id's and internal word settings are now set using a "pageTag". This allows code 
  to be re-used between testing and requirement style settings. The tags are req- for
  requirements and test- for test cases.*/
  /*hides the send button when they select an artifact type, so if they had completed
  style mappings for one or the other then change the artifact type they are required to enter
  their style mappings again.*/
  clearErrors();
  hideElement('send-to-spira');
  //checks the current selected artifact type then loads the appropriate menu
  if (pageTag == "req-") {
    document.getElementById("select-requirements").classList.add("activated");
    document.getElementById("select-test-cases").classList.remove("activated");
    showElement('req-style-mappings');
    hideElement('test-style-mappings');
  }
  //opens the test cases style mappings if test mappings is the selected artifact type
  else {
    document.getElementById("select-test-cases").classList.add("activated");
    document.getElementById("select-requirements").classList.remove("activated");
    hideElement('req-style-mappings');
    showElement('test-style-mappings');
  }
  //wont populate styles for requirements if it is already populated
  if (document.getElementById("req-style-select1").childElementCount && pageTag == "req-") {
    return
  }
  //wont populate styles for test-cases if it is already populated
  else if (document.getElementById("test-style-select1").childElementCount && pageTag == "test-") {
    return
  }
  //doesnt populate styles if both test & req style selectors are populated

  //retrieveStyles gets the document's settings for the style mappings. Also auto sets default values
  let settings = retrieveStyles(pageTag)
  //Goes line by line and retrieves any custom styles the user may have used.
  let styles = await getStyles();
  //only the top 2 select objects should have all styles. bottom 3 are table based (at least for now).
  if (pageTag == "test-") {
    for (let i = 1; i <= 2; i++) {
      populateStyles(styles, pageTag + 'style-select' + i.toString());
    }
    //bottom 3 selectors will be related to tables
    for (let i = 3; i <= 5; i++) {
      let tableStyles = ["column1", "column2", "column3", "column4", "column5"]
      populateStyles(tableStyles, pageTag + 'style-select' + i.toString())
    }
  }
  else {
    for (let i = 1; i <= 5; i++) {
      populateStyles(styles, pageTag + 'style-select' + i.toString());
    }
  }
  //move selectors to the relevant option
  settings.forEach((setting, i) => {
    document.getElementById(pageTag + "style-select" + (i + 1).toString()).value = setting
  })
}

//closes the style mapping page taking in a boolean 'result'
//pageTag is req or test depending on which page is currently open

const confirmStyleMappings = async (pageTag) => {
  //saves the users style preferences. this is document bound
  let styles = []
  for (let i = 1; i <= 5; i++) {
    if (document.getElementById(pageTag + "style-select" + i.toString()).value) {
      let setting = document.getElementById(pageTag + "style-select" + i.toString()).value
      //checks if a setting is used multiple times
      if (!styles.includes(setting)) {
        styles.push(setting)
      }
      //gives an error explaining they have duplicate style mappings and cannot proceed.
      else {
        displayError(ERROR_MESSAGES.duplicateStyles)
        //hides the final button if it is already displayed when a user inputs invalid styles.
        hideElement('send-to-spira');
        return
      }
      Office.context.document.settings.set(pageTag + 'style' + i.toString(), setting);
    }
    //gives an error explaining they have empty style mappings.
    else {
      displayError(ERROR_MESSAGES.emptyStyles)
      return
    }
  }
  //hides error on successful confirm
  clearErrors();
  //this saves the settings
  Office.context.document.settings.saveAsync()
  //show the send to spira button after this is clicked and all style selectors are populated.
  showElement('send-to-spira');
}

//Populates a passed in style-selector with the avaiable word styles
const populateStyles = (styles, element_id) => {
  let dropdown = document.getElementById(element_id)
  styles.forEach((style) => {
    /* Creates an option for each style available */
    let option = document.createElement("option");
    option.text = style
    option.value = style
    dropdown.add(option);
  })
}

const clearDropdownElement = (element_id) => {
  let dropdown = document.getElementById(element_id);
  while (dropdown.length > 0) {
    dropdown.remove(0);
  }
}

const updateProgressBar = (current, total) => {
  let width = current / total * 100;
  let bar = document.getElementById("progress-bar-progress");
  bar.style.width = width + "%";
  if (current == total) {
    document.getElementById('pop-up').classList.remove('sending');
    document.getElementById('pop-up').classList.add('sent');
    document.getElementById('pop-up-text').textContent = `Sent ${total} 
    ${document.getElementById('select-requirements').classList.contains('activated') ?
        "Requirements!" : "Test Cases!"}`;
    enableButton('pop-up-ok');
  }
  else {
    document.getElementById('pop-up-text').textContent = `Sending ${total} 
    ${document.getElementById('select-requirements').classList.contains('activated') ?
        "Requirements!" : "Test Cases!"}`;
  }
  return true
}

const showProgressBar = () => {
  disableButton('pop-up-ok');
  showElement('pop-up');
  document.getElementById('pop-up').classList.remove('sent');
  document.getElementById('pop-up').classList.remove('err');
  document.getElementById('pop-up').classList.add('sending');
  document.getElementById('pop-up-text').textContent = "Parsing Document..."
  document.getElementById("progress-bar-progress").style.width = "0%";
  document.getElementById("progress-bar").classList.remove("hidden");
}

const hideProgressBar = () => {
  document.getElementById('pop-up').classList.remove('sending');
  document.getElementById('pop-up').classList.remove('sent');
  document.getElementById("progress-bar-progress").style.width = "0%";
  hideElement('progress-bar');
}

const displayError = (error, timeOut, failedArtifact) => {
  //We may want to update this to pass in the full object for better readability
  //rather than just passing in the key. (ie. instead of key, pass ERROR_MESSAGES['key'])
  console.log('got called'
  )
  let element = document.getElementById(error.htmlId);
  hideProgressBar();
  enableButton('pop-up-ok');
  document.getElementById('pop-up').classList.add('err');
  showElement('pop-up')
  console.log("getting in")
  if (timeOut) {
    element.textContent = error.message;
    setTimeout(() => {
      clearErrors();
    }, ERROR_MESSAGES.stdTimeOut);
  }
  else if (failedArtifact) { // This is a special case error message for more descriptive errors when sending artifacts
    element.textContent =
      `The request to the API has failed on the Artifact: '${failedArtifact.Name}'. All, if any previous Artifacts should be in Spira.`;
    setTimeout(() => {
      clearErrors();
    }, ERROR_MESSAGES.stdTimeOut);
  }
  else {
    element.textContent = error.message;
  }
}

const clearErrors = () => {
  hideElement('pop-up');
  document.getElementById('pop-up').classList.remove('err');
  document.getElementById('pop-up-text').textContent = "";
}

const goToState = (state) => {
  let states = params.pageStates;
  switch (state) {
    case (states.authentication):

      // clear stored user data
      model.clearUser();
      // hide main selection screen
      hideElement('main-screen');

      // removes currently entered RSS token to prevent a user from leaving their login credentials
      // populated after logging out and leaving their computer.
      document.getElementById("input-password").value = ""

      // Show authentication page
      showElement('panel-auth');
      clearDropdownElement('project-select');

      // Hides style mappings
      hideElement('req-style-mappings');
      hideElement('test-style-mappings');
      // document.getElementById("req-style-mappings").style.display = 'none'
      // document.getElementById("test-style-mappings").style.display = 'none'

      // Resets artifact button colors
      document.getElementById("select-requirements").classList.remove("activated");
      document.getElementById("select-test-cases").classList.remove("activated");

      // Hides artifact text and buttons
      hideElement('artifact-select-text');
      hideElement('select-requirements');
      hideElement('select-test-cases');

      // Hides send to spira menu and enables button
      hideElement('send-to-spira');
      hideProgressBar();
      document.getElementById("send-to-spira-button").disabled = false;

      // Clear any error messages that exist
      clearErrors();
      break;
    case (states.projects):
      hideElement('panel-auth');
      showElement('main-screen');
      break;
    case (states.artifact):
      // Show artifact text and buttons
      showElement('artifact-select-text');
      showElement('select-requirements');
      showElement('select-test-cases');

      // If the dropdown has a null value then clear it away
      document.getElementById('project-select').remove('null')
      break;
    case (states.dev):
      //moves us to the main interface without manually entering credentials
      hideElement('panel-auth');
      document.getElementById('main-screen').classList.remove('hidden');
      document.getElementById("main-screen").style.display = "flex";
      addDefaultProject();
      let devOption = document.createElement("option");
      devOption.text = "Test";
      devOption.value = null;
      document.getElementById("project-select").add(devOption);
      break;
    case (states.helpLogin):
      // moves us to the help screen and makes the back button take us to the login page
      hideElement('panel-auth');
      showElement('help-screen');
      document.getElementById('btn-help-back').onclick = () => {
        hideElement('help-screen');
        goToState(states.authentication);
      };
      break;
    case (states.helpMain):
      // moves us to the help screen and makes the back button take us to the project select page
      hideElement('main-screen');
      showElement('help-screen');
      document.getElementById('btn-help-back').onclick = () => {
        hideElement('help-screen');
        goToState(states.projects);
      }
      break;
  }
}

//section is the Html id of the help section selected
const openHelpSection = (buttonId) => {
  for (let buttonId of params.collections.helpButtons){
    document.getElementById(buttonId).classList.remove('activated')
  }
  let section = buttonId.replace("btn-", "")
  document.getElementById(buttonId).classList.add('activated')
  //hides the help sections before showing the relevant one
  for (let section of params.collections.helpSections) {
    hideElement(section)
  }
  showElement(section)
}

const addDefaultProject = () => {
  let nullProject = document.createElement("option");
  nullProject.text = "       ";
  nullProject.value = null;
  document.getElementById("project-select").add(nullProject);
}

const hideElement = (element_id) => {
  document.getElementById(element_id).classList.add('hidden');
}

const showElement = (element_id) => {
  document.getElementById(element_id).classList.remove('hidden');
}

/*********************
Pure data manipulation
**********************/

//This is the initialization call that determines the artifactType id based on user selection
//before passing off to parseArtifacts() in server.js.
const pushArtifacts = async () => {
  let active = document.getElementById("test-style-mappings").classList.contains('hidden')
  //if the requirements style mappings are visible that is the selected artifact.
  let artifactType = params.artifactEnums.testCases;
  if (active) {
    artifactType = params.artifactEnums.requirements
  }
  disableMainButtons();
  await parseArtifacts(artifactType, model, versionSupport);
  enableMainButtons();
}

/* Returns an array with all of the styles intended to be used for the 
  Style dropdown menus */
const getStyles = async () => {
  let userStyles = await usedStyles();
  let allStyles = await trimStyles(Object.values(Word.Style), userStyles)
  return allStyles;
}

/* Returns a new array by filtering out styles from the first set and adding them to the second set*/
const trimStyles = async (styles, prevStyles) => {
  let newStyles = prevStyles;
  for (let i = 0; i < styles.length; i++) {
    let style = styles[i];
    // only add the style to the new set if none of these are in the string
    if (style.indexOf("Toc") < 0 && style.indexOf("Table") < 0 && style.indexOf("Other") < 0 && style.indexOf("Normal") < 0) {
      //make sure there are no repeats
      if (!newStyles.includes(style)) {
        newStyles.push(style)
      }
    }
  }
  return newStyles;
}

/* Returns the array of all used styles in the selection */
const usedStyles = async () => {
  let styles = [];
  //this is an old method, but makes sense to use here as this occurs before the user 
  await updateSelectionArray();
  for (let i = 0; i < SELECTION.length; i++) {
    //normal is a reserved style for descriptions of requirements
    if (!styles.includes(SELECTION[i].style) && SELECTION[i].style != "Normal") {
      styles.push(SELECTION[i].style);
    }
  }
  return styles;
}

export {
  disableButton,
  displayError,
  clearErrors,
  showProgressBar,
  updateProgressBar,
  hideProgressBar,
  enableButton,
  enableMainButtons,
  disableMainButtons
}
