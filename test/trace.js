"use strict";
const benchmark = require("benchmark");
const dummyJson = require("dummy-json");
global.dummyJson = dummyJson;

const yacbor = require("../cbor.js");

const encodeSuite = new benchmark.Suite;
const decodeSuite = new benchmark.Suite;

global.object = undefined;
global.encodedObject = undefined;

const objectTemplate = '{\n\
  "user": {\n\
    "id": {{int 0 9999999}},\n\
    "name": "{{firstName}} {{lastName}}",\n\
    "work": "{{company}}",\n\
    "email": "{{email}}",\n\
    "dob": "{{date \'1900\' \'2000\' \'DD/MM/YYYY\'}}",\n\
    "address": "{{int 1 100}} {{street}}",\n\
    "city": "{{city}}",\n\
    "optedin": {{boolean}},\n\
    "images": [\n\
      "img{{int 0 9999999}}.png",\n\
      "alt{{int 0 9999999}}.png"\n\
    ],\n\
    "extended": null\n\
  },\n\
  "coordinates": {\n\
    "x": {{float -50 50 \'0.00\'}},\n\
    "y": {{float -25 25 \'0.00\'}}\n\
  }\n\
}';
global.objectTemplate = objectTemplate;

function expose(f) {
	global[f.name] = f;
}

function yacborEncode() {
	encodedObject = yacbor.encode(object);
}
expose(yacborEncode);

function yacbor2Encode() {
	encodedObject = yacbor.encode(object,{noExplicitConversion:true});
}
expose(yacbor2Encode);

function yacbor3Encode() {
	encodedObject = yacbor.encode(object,{allNumbersAreDoubles:true});
}
expose(yacbor3Encode);

function yacbor4Encode() {
	encodedObject = yacbor.encode(object,{noExplicitConversion:true,allNumbersAreDoubles:true});
}
expose(yacbor4Encode);

function yacborDecode() {
	object = yacbor.decode(encodedObject);
}
expose(yacborDecode);

function jsonEncode() {
	encodedObject = JSON.stringify(object);
}
expose(jsonEncode);

function jsonDecode() {
	object = JSON.parse(encodedObject);
}
expose(jsonDecode);

function jsonNewObject() {
	object = JSON.parse(dummyJson.parse(objectTemplate));
	object._poked = true;
}
expose(jsonNewObject);

function yacborNewEncodedObject() {
	jsonNewObject();
	yacborEncode();
}
expose(yacborNewEncodedObject);

yacborNewEncodedObject();


encodeSuite
	.add("yacbor", yacborEncode, { setup: jsonNewObject })
	.add("yacbor NEC", yacbor2Encode, { setup: jsonNewObject })
	.add("yacbor AND", yacbor3Encode, { setup: jsonNewObject })
	.add("yacbor NEC+AND", yacbor4Encode, { setup: jsonNewObject })
	.on('start', function (event) {
		console.log("Starting encode tests at " + (new Date));
	})
	.on('cycle', function (event) {
		console.log(String(event.target));
	})
	.on('complete', function () {
		console.log('Completed at ' + (new Date));
		console.log('Fastest: ' + this.filter('fastest').map('name').join(', '));
	})
	.on('error', function (event) {
		console.log("Error: " + event.target.error.stack);
	})
	.run({
		async: false
	})
	.run({
		async: false
	});

decodeSuite
	.add("yacbor", yacborDecode, { setup: yacborNewEncodedObject })
	.on('start', function (event) {
		console.log("Starting decode tests at " + (new Date));
	})
	.on('cycle', function (event) {
		console.log(String(event.target));
	})
	.on('complete', function () {
		console.log('Completed at ' + (new Date));
		console.log('Fastest: ' + this.filter('fastest').map('name').join(', '));
	})
	.on('error', function (event) {
		console.log("Error: " + event.target.error.stack);
	})
	.run({
		async: false
	});

