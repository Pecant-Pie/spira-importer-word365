const axios = require('axios')
const superagent = require('superagent');
//ignore it saying defaults doesnt exist, it does and using default does not work.
//makes sure put requests uses the proper content-type header
axios.defaults.headers.put['Content-Type'] = "application/json"
axios.defaults.headers.put['accept'] = "application/json"

import { Data, tempDataStore, params, templates } from './model.js'
import {
  disableButton,
  retrieveStyles,
  validateHierarchy,
  filterForLists,
  validateTestSteps
} from './taskpane.js';

var RETRIEVE = "http://localhost:5000/retrieve"

const parseArtifacts = async (ArtifactTypeId) => {
  return Word.run(async (context) => {
    disableButton("send-to-spira-button");
    /***************************
     Start range identification
     **************************/
    let projectId = new tempDataStore(document.getElementById("project-select").value)
    let selection = context.document.getSelection();
    let splitSelection = context.document.getSelection().split(['\r']);
    context.load(selection, ['text', 'inlinePictures', 'style', 'styleBuiltIn']);
    context.load(splitSelection, ['text', 'inlinePictures', 'style', 'styleBuiltIn'])
    await context.sync();
    //If there is no selected area, parse the full body of the document instead
    if (!selection.text) {
      selection = context.document.body.getRange();
      splitSelection = context.document.body.getRange().split(['\r']);
      context.load(selection, ['text', 'inlinePictures', 'style', 'styleBuiltIn']);
      context.load(splitSelection, ['text', 'inlinePictures', 'style', 'styleBuiltIn'])
      await context.sync();
    }
    /********************** 
     Start image formatting
    ***********************/
    var imageLines = []
    //i represents each "line" delimited by \r tags
    for (let i = 0; i < splitSelection.items.length; i++) {
      //this checks if there are any images at all on a given line
      if (splitSelection.items[i].inlinePictures.items[0]) {
        //this pushes the 'line number' for each image on a particular line.
        for (let line in splitSelection.items[i].inlinePictures.items) {
          imageLines.push(i)
        }
      }
    }
    var imageObjects = [];
    let images = selection.inlinePictures;
    for (let i = 0; i < images.items.length; i++) {
      let base64 = images.items[i].getBase64ImageSrc();
      await context.sync();
      let imageObj = new templates.Image(base64.m_value, `inline${i}.jpg`, imageLines[0])
      imageObjects.push(imageObj)
      //removes the first item in imageLines as it has been converted to an imageObject;
      imageLines.shift();
    }
    //end of image formatting
    /**********************
     Start Artifact Parsing
    ***********************/
    const bodyRegex = /<body(.)*?<\/body>/gu
    switch (ArtifactTypeId) {
      //this will parse the data assuming the user wants requirements to be imported.
      case (params.artifactEnums.requirements): {
        /*this returns the styles in an array to be referenced 
        against text in the document*/
        let styles = retrieveStyles('req-');
        let descStart, descEnd;
        //var for later unscoped access to this variable when artifacts are sent to spira
        var requirements = [];
        let body = splitSelection;
        let requirement = new templates.Requirement()
        for (let [i, item] of body.items.entries()) {
          //style stores custom styles while styleBuiltIn only stores default styles
          if (styles.includes(item.styleBuiltIn) || styles.includes(item.style)) {
            /*this wraps up the description of the previous requirement, pushes to
            requirements array, and creates a new requirement object*/
            if (descStart) {
              descEnd = body.items[i - 1]
              await axios.post(RETRIEVE, { in: "DescStart condiiton" })
              /*creates a description range given the beginning 
              and end as delimited by lines with mapped styles*/
              let descRange = descStart.expandToOrNullObject(descEnd)
              await context.sync();
              //descRange is null if the descEnd is not valid to extend the descStart
              if (!descRange) {
                descRange = descStart
              }
              //clears these fields so it is known the description has been added to its requirement
              descStart = undefined
              descEnd = undefined
              let descHtml = descRange.getHtml();
              await context.sync();
              //m_value is the actual string of the html
              /**
               * filter against regex here and remove body tags
               */
              requirement.Description = await filterForLists(descHtml.m_value.replaceAll("\r", ""));
              requirements.push(requirement)
              /*gets the requirement of the to be created requirement based
               on its index in the styles array.*/
              let indent = styles.indexOf(item.styleBuiltIn)
              if (!indent) {
                indent = styles.indexOf(item.style)
              }
              //creates new requirement and populates relevant fields 
              requirement = new templates.Requirement();
              requirement.Name = item.text.replaceAll("\r", "")
              requirement.IndentLevel = indent
            }
            else if (requirement.Name) {
              requirements.push(requirement)
              /*gets the requirement of the to be created requirement based
               on its index in the styles array.*/
              let indent = styles.indexOf(item.styleBuiltIn)
              if (!indent) {
                indent = styles.indexOf(item.style)
              }
              //creates new requirement and populates relevant fields 
              requirement = new templates.Requirement();
              requirement.Name = item.text.replaceAll("\r", "")
              requirement.IndentLevel = indent
            }
            //This should only happen for the first indent level 1 line parsed
            else {
              requirement.Name = item.text.replaceAll("\r", "")
            }
          }
          else {
            if (!descStart) {
              await axios.post(RETRIEVE, { desc: "Start made" })
              descStart = item
            }
          }
          /*if a line is the last line in the selection/body
          & the current requirement object has least a name,
          & the name is not the current line's text 
          push the last requirement*/
          if (i == body.items.length - 1 && requirement.Name && item.text != requirement.Name) {
            if (item.text) {
              let descRange;
              //if it has a start - expand the range to the end of the description block
              if (descStart) {
                descEnd = item
                descRange = descStart.expandToOrNullObject(descEnd)
              }
              else {
                descRange = item
              }
              await context.sync()
              //this covers if the expandToOrNullObject returns null
              if (!descRange) {
                descRange = descStart
              }
              let descHtml = descRange.getHtml();
              await context.sync();
              /**
               * Filter against regex here as well - also need to remove body tags
               */
              requirement.Description = await filterForLists(descHtml.m_value.replaceAll("\r", ""));
            }
            axios.post(RETRIEVE, { req: requirement })
            requirements.push(requirement)
          }
        }
        if (!validateHierarchy(requirements)) {
          requirements = false
          document.getElementById("send-to-spira-button")
          //throw hierarchy error and exit
        }
        //if the heirarchy is invalid, clear requirements and throw error
        await axios.post(RETRIEVE, { reqs: requirements })
        break
      }
      case (params.artifactEnums.testCases): {
        let tableCounter = 0
        let testCases = []
        let styles = retrieveStyles('test-')
        let testCase = new templates.TestCase()
        await axios.post(RETRIEVE, { init: "working" })
        /********************
         * Parsing out tables
         ********************/
        let selectionTables = selection.tables
        context.load(selectionTables)
        await context.sync();
        //tables = 3d array [table][test step][column], only contains text
        var tables = [];
        for (let i = 0; i < selectionTables.items.length; i++) {
          let table = selectionTables.items[i].values;
          tables.push(table)
        }
        /*May not need this, but it is the images in the FIRST TABLE. If i need it I 
        will make it procedural for each given table when images are placed in spira.*/
        let tableImages = selectionTables.items[0].getRange().inlinePictures;
        context.load(tableImages)
        await context.sync();
        if (!validateTestSteps(tables, styles[2]))
          break
      }
    }
  })
}


export {
  parseArtifacts
}