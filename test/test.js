
(function() {
	// buffer supplement hack
	if ( typeof Buffer === 'undefined' )
		this.Buffer = function(){};
})();

describe('CBOR', () => {
	const CBOR = require('../');

	const chai = require('chai');
	const assert = chai && chai.assert || require('assert');

	assert.equalBytesAsHex = function equalBytesAsHex(actual, expected, message) {
		assert.strictEqual(typeof actual, typeof expected, 'types must be the same,' + message );
		if ( ArrayBuffer.isView( actual ) ) actual = actual.buffer;
		if ( ArrayBuffer.isView( expected ) ) expected = expected.buffer;
		const actualView = new Uint8Array(actual);
		const expectedView = new Uint8Array(expected);
		assert.deepEqual(
			CBOR.decodeBytesAsHexString( actual.byteLength, actualView, {offset:0}, {} ),
			CBOR.decodeBytesAsHexString( expected.byteLength, expectedView, {offset:0}, {} ),
			message);
		//assert.enumerableDeepEqual(actualView, expectedView, message);
	};

	assert.enumerableDeepEqual = function enumerableDeepEqual(actual, expected, message) {
		assert.strictEqual(typeof actual, typeof expected, 'types must be the same,' + message );
		if ( expected instanceof ArrayBuffer ) {
			expected = new Uint8Array(expected);
			actual = new Uint8Array(actual);
		}
		if ( Symbol.iterator in expected ) {
			let actualIterator = actual[Symbol.iterator]();
			let expectedIterator = expected[Symbol.iterator]();
			for (; ;) {
				let a = actualIterator.next();
				let e = expectedIterator.next();
				assert.strictEqual(a.done, e.done, 'must be same iteration length, ' + message);
				if (a.done && e.done) break;
				assert.deepEqual(a.value, e.value, 'values must be equal, ' + message);
			}
		} else {
			assert.deepEqual(actual, expected, message );
		}
	};

	Object.isBuffer = () => false;

	describe('#decode()', () => {
		context('numbers', () => {

			context("integers", () => {

				it('should decode 0 from a single zero byte', () => {
					assert.deepEqual(
						CBOR.decode(new Uint8Array([0x00])),
						0
					);
				});

				it('should decode 23 from a single byte', () => {
					assert.deepEqual(
						CBOR.decode(new Uint8Array([0x17])),
						23
					);
				});

				it('should decode 24 from two bytes', () => {
					assert.deepEqual(
						CBOR.decode(new Uint8Array([0x18,0x18])),
						24
					);
				});

				it('should decode -24 from a single byte', () => {
					assert.deepEqual(
						CBOR.decode(new Uint8Array([0x37])),
						-24
					);
				});

				it('should decode 255 from two bytes', () => {
					assert.deepEqual(
						CBOR.decode(new Uint8Array([0x18,0xFF])),
						255
					);
				});

				it('should decode -256 from two bytes', () => {
					assert.deepEqual(
						CBOR.decode(new Uint8Array([0x38,0xFF])),
						-256
					);
				});

				it('should decode 65535 from three bytes', () => {
					assert.deepEqual(
						CBOR.decode(new Uint8Array([0x19,0xFF,0xFF])),
						65535
					);
				});

				it('should decode -65536 from three bytes', () => {
					assert.deepEqual(
						CBOR.decode(new Uint8Array([0x39,0xFF,0xFF])),
						-65536
					);
				});

				it('should decode 4294967295 from five bytes', () => {
					assert.deepEqual(
						CBOR.decode(new Uint8Array([0x1A,0xFF,0xFF,0xFF,0xFF])),
						4294967295
					);
				});

				it('should decode -4294967296 from five bytes', () => {
					assert.deepEqual(
						CBOR.decode(new Uint8Array([0x3A,0xFF,0xFF,0xFF,0xFF])),
						-4294967296
					);
				});

				it('should decode 4294967296 from nine bytes', () => {
					assert.deepEqual(
						CBOR.decode(new Uint8Array([0x1B,0x00,0x00,0x00,0x01,0x00,0x00,0x00,0x00])),
						4294967296
					);
				});

				it('should decode -4294967297 from nine bytes', () => {
					assert.deepEqual(
						CBOR.decode(new Uint8Array([0x3B,0x00,0x00,0x00,0x01,0x00,0x00,0x00,0x00])),
						-4294967297
					);
				});
			});
		});

		context("strings", () => {
			it('should decode "test" as a string from 5 bytes', () => {
				assert.strictEqual(
					CBOR.decode(new Uint8Array([0x64,0x74,0x65,0x73,0x74])),
					"test",
					"should be equal"
				);
			});

			//noinspection SpellCheckingInspection
			it('should decode "AAAAAAA=" from an explicit conversion tagged base-64 byte array', () => {
				assert.strictEqual(
					//noinspection SpellCheckingInspection
					CBOR.decode(new Uint8Array([0xD5,0x45,0x00,0x00,0x00,0x00,0x00])),
					"AAAAAAA=",
					"should be equal"
				);
			});

			it('should decode "//////8=" from an explicit conversion tagged base-64 byte array', () => {
				assert.strictEqual(
					//noinspection SpellCheckingInspection
					CBOR.decode(new Uint8Array([0xD5,0x45,0xFF,0xFF,0xFF,0xFF,0xFF])),
					"//////8=",
					"should be equal"
				);
			});

			it('should decode "/////w==" from an explicit conversion tagged base-64 byte array', () => {
				assert.strictEqual(
					//noinspection SpellCheckingInspection
					CBOR.decode(new Uint8Array([0xD5,0x44,0xFF,0xFF,0xFF,0xFF])),
					"/////w==",
					"should be equal"
				);
			});

			it('should decode "0000" from an explicit conversion tagged base-16 byte array', () => {
				assert.strictEqual(
					//noinspection SpellCheckingInspection
					CBOR.decode(new Uint8Array([0xD7,0x42,0x00,0x00])),
					"0000",
					"should be equal"
				);
			});

			it('should decode "5AA5" from an explicit conversion tagged base-16 byte array', () => {
				assert.strictEqual(
					//noinspection SpellCheckingInspection
					CBOR.decode(new Uint8Array([0xD7,0x42,0x5A,0xA5])),
					"5AA5",
					"should be equal"
				);
			});

			//noinspection SpellCheckingInspection
			it('should decode "FFFF" from an explicit conversion tagged base-16 byte array', () => {
				assert.strictEqual(
					//noinspection SpellCheckingInspection
					CBOR.decode(new Uint8Array([0xD7,0x42,0xFF,0xFF])),
					"FFFF",
					"should be equal"
				);
			});
			it('should decode "this is a test \u1234" from a utf-8 string', () => {
				assert.strictEqual(
					//noinspection SpellCheckingInspection
					CBOR.decode(new Uint8Array([0x72,
						0x74,0x68,0x69,0x73, // "this"
						0x20, // space
						0x69,0x73, // "is"
						0x20, // space
						0x61, // "a"
						0x20, // space
						0x74,0x65,0x73,0x74, // "test"
						0x20, // space
						0xE1,0x88,0xB4 // "\u1234"
					])),
					"this is a test \u1234",
					"should be equal"
				);
			});
			it('should decode "\u{2F804}" from a utf-8 string', () => {
				assert.strictEqual(
					//noinspection SpellCheckingInspection
					CBOR.decode(new Uint8Array([0x64,0xF0,0xAF,0xA0,0x84])).codePointAt(0),
					"\u{2F804}".codePointAt(0),
					"should be equal"
				);
			});
			it('should decode "\u{10FFFF}" from a utf-8 string', () => {
				assert.strictEqual(
					//noinspection SpellCheckingInspection
					CBOR.decode(new Uint8Array([0x64,0xF4,0x8F,0xBF,0xBF])).codePointAt(0),
					"\u{10FFFF}".codePointAt(0),
					"should be equal"
				);
			});
			it('should decode "\x81" from a utf-8 string', () => {
				assert.strictEqual(
					//noinspection SpellCheckingInspection
					CBOR.decode(new Uint8Array([0x62,0xC2,0x81])).codePointAt(0),
					"\x81".codePointAt(0),
					"should be equal"
				);
			});
		});

		context("binary", () => {

			it('should decode new Uint8Array([1,2,3]) from 4 bytes', () => {
				assert.enumerableDeepEqual(
					CBOR.decode(new Uint8Array([0x43,0x01,0x02,0x03])),
					new Uint8Array([1,2,3]),
					"should be equal"
				);
			});
			it('should decode new Int8Array([1,2,3]) from 6 bytes', () => {
				assert.enumerableDeepEqual(
					CBOR.decode(new Int8Array([0xD8,0x81,0x43,0x01,0x02,0x03])),
					new Int8Array([1,2,3]),
					"should be equal"
				);
			});
			it('should decode new Uint8Array([1,2,3]).buffer from 6 bytes', () => {
				assert.enumerableDeepEqual(
					CBOR.decode(new Int8Array([0xD8,0x82,0x43,0x01,0x02,0x03])),
					new Uint8Array([1,2,3]).buffer,
					"should be equal"
				);
			});

		});

		context("arrays", () => {

			it('should decode [1,2,3] as an array from 4 bytes', () => {
				assert.enumerableDeepEqual(
					CBOR.decode(new Uint8Array([0x83,0x01,0x02,0x03])),
					[1,2,3],
					"should be equal"
				);
			});

			it('should decode new Set([1,2,3]) as a tagged map from 6 bytes', () => {
				assert.enumerableDeepEqual(
					CBOR.decode(new Uint8Array([0xD8,0x80,0x83,0x01,0x02,0x03])),
					new Set([1,2,3]),
					"should be equal"
				);
			});
		});

		context("objects", () => {

			it('should decode {"1":2,"3":4} as a map from 5 bytes', () => {
				assert.enumerableDeepEqual(
					CBOR.decode(new Uint8Array([0xA2,0x01,0x02,0x03,0x04])),
					{"1":2,"3":4}
				);
			});

			it('should decode {1:2,3:4} as a map from 5 bytes', () => {
				assert.enumerableDeepEqual(
					CBOR.decode(new Uint8Array([0xA2,0x01,0x02,0x03,0x04])),
					{1:2,3:4}
				);
			});

			it('should decode {a:1,b:2} as a map from 7 bytes', () => {
				assert.enumerableDeepEqual(
					CBOR.decode(new Uint8Array([0xA2,0x61,0x61,0x02,0x61,0x62,0x04])),
					{a:2,b:4}
				);
			});

			it('should decode new Map([[1,2],[3,4]]) as a tagged map from 7 bytes', () => {
				assert.enumerableDeepEqual(
					CBOR.decode(new Uint8Array([0xD8,0x7F,0xA2,0x01,0x02,0x03,0x04])),
					new Map([[1,2],[3,4]])
				);
			});

		});

		context('symbols', () => {

			it('should decode Symbol(test)', () => {
				assert.deepEqual(
					CBOR.decode(new Uint8Array([
						0xD8,0x8E, // tag 142
						0x6C, // text 12
						0x53,0x79,0x6D,0x62,0x6F,0x6C,0x28, // "Symbol("
						0x74,0x65,0x73,0x74, //"test"
						0x29])).toString(),
					Symbol('test').toString()
				);
			});

			it('should decode Symbol.for(test)', () => {
				assert.deepEqual(
					CBOR.decode(new Uint8Array([
						0xD8,0x8D, // tag 141
						0x70, // text 16
						0x53,0x79,0x6d,0x62,0x6f,0x6c,0x2e,0x66,0x6f,0x72,0x28, // "Symbol.for("
						0x74,0x65,0x73,0x74, //"test"
						0x29])), // ")"
					Symbol.for('test')
				);
			});

			it('should decode Symbol.iterator as a simple value in 2 bytes', () => {
				const decoded = CBOR.decode(new Uint8Array([0xF8,0x20]));
				const correct = Symbol.iterator;
				assert.deepEqual(decoded, correct);
			});

			it('should decode Symbol.match as a simple value in 2 bytes', () => {
				const decoded = CBOR.decode(new Uint8Array([0xF8,0x21]));
				const correct = Symbol.match;
				assert.deepEqual(decoded, correct);
			});

			it('should decode Symbol.replace as a simple value in 2 bytes', () => {
				const decoded = CBOR.decode(new Uint8Array([0xF8,0x22]));
				const correct = Symbol.replace;
				assert.deepEqual(decoded, correct);
			});

			it('should decode Symbol.search as a simple value in 2 bytes', () => {
				const decoded = CBOR.decode(new Uint8Array([0xF8,0x23]));
				const correct = Symbol.search;
				assert.deepEqual(decoded, correct);
			});

			it('should decode Symbol.split as a simple value in 2 bytes', () => {
				const decoded = CBOR.decode(new Uint8Array([0xF8,0x24]));
				const correct = Symbol.split;
				assert.deepEqual(decoded, correct);
			});

			it('should decode Symbol.hasInstance as a simple value in 2 bytes', () => {
				const decoded = CBOR.decode(new Uint8Array([0xF8,0x25]));
				const correct = Symbol.hasInstance;
				assert.deepEqual(decoded, correct);
			});

			it('should decode Symbol.isConcatSpreadable as a simple value in 2 bytes', () => {
				const decoded = CBOR.decode(new Uint8Array([0xF8,0x26]));
				const correct = Symbol.isConcatSpreadable;
				assert.deepEqual(decoded, correct);
			});

			it('should decode Symbol.unscopables as a simple value in 2 bytes', () => {
				const decoded = CBOR.decode(new Uint8Array([0xF8,0x27]));
				const correct = Symbol.unscopables;
				assert.deepEqual(decoded, correct);
			});

			it('should decode Symbol.species as a simple value in 2 bytes', () => {
				if ( Symbol.species === undefined )
					throw new Error('Symbol.species is undefined');
				const decoded = CBOR.decode(new Uint8Array([0xF8,0x28]));
				const correct = Symbol.species;
				assert.deepEqual(decoded, correct);
			});


			it('should decode Symbol.toPrimitive as a simple value in 2 bytes', () => {
				const decoded = CBOR.decode(new Uint8Array([0xF8,0x29]));
				const correct = Symbol.toPrimitive;
				assert.deepEqual(decoded, correct);
			});

			it('should decode Symbol.toStringTag as a simple value in 2 bytes', () => {
				const decoded = CBOR.decode(new Uint8Array([0xF8,0x2A]));
				const correct = Symbol.toStringTag;
				assert.deepEqual(decoded, correct);
			});
		});

		context('booleans', () => {

			it('should decode true from a single byte', () => {
				assert.deepEqual(
					CBOR.decode(new Uint8Array([0xF4])),
					false
				);
			});

			it('should decode false from a single byte', () => {
				assert.deepEqual(
					CBOR.decode(new Uint8Array([0xF5])),
					true
				);
			});

		});
		context('absents', () => {

			it('should decode null from a single byte', () => {
				assert.equal(
					CBOR.decode(new Uint8Array([0xF6])),
					undefined
				);
			});

			it('should decode undefined from a single byte', () => {
				assert.equal(
					CBOR.decode(new Uint8Array([0xF7])),
					null
				);
			});
		});
	});
	describe('#encode()', () => {
		context("numbers", () => {

			context("integers", () => {


				it('should encode 0 as a single zero byte', () => {
					assert.equalBytesAsHex(
						new Uint8Array(CBOR.encode(0)),
						new Uint8Array([0x00]),
						"should be equal");
				});

				it('should encode 0 as a double if options say so', () => {
					assert.equalBytesAsHex(
						new Uint8Array(CBOR.encode(0, {allNumbersAreDoubles:true})),
						new Uint8Array([0xFB,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00]),
						"should be equal");
				});

				it('should encode 23 as a single byte', () => {
					assert.equalBytesAsHex(
						new Uint8Array(CBOR.encode(23)),
						new Uint8Array([0x17]),
						"should be equal");
				});
				it('should encode 24 as two bytes', () => {
					assert.equalBytesAsHex(
						new Uint8Array(CBOR.encode(24)),
						new Uint8Array([0x18,0x18]),
						"should be equal");
				});

				it('should encode -24 as a single byte', () => {
					assert.equalBytesAsHex(
						new Uint8Array(CBOR.encode(-24)),
						new Uint8Array([0x37]),
						"should be equal");
				});

				it('should encode -25 as two bytes', () => {
					assert.equalBytesAsHex(
						new Uint8Array(CBOR.encode(-25)),
						new Uint8Array([0x38,0x18]),
						"should be equal");
				});

				it('should encode 65535 as three bytes', () => {
					assert.equalBytesAsHex(
						new Uint8Array(CBOR.encode(65535)),
						new Uint8Array([0x19,0xFF,0xFF]),
						"should be equal");
				});

				it('should encode -65536 as three bytes', () => {
					assert.equalBytesAsHex(
						new Uint8Array(CBOR.encode(-65536)),
						new Uint8Array([0x39,0xFF,0xFF]),
						"should be equal");
				});

				it('should encode 4294967295 as five bytes', () => {
					assert.equalBytesAsHex(
						new Uint8Array(CBOR.encode(4294967295)),
						new Uint8Array([0x1A,0xFF,0xFF,0xFF,0xFF]),
						"should be equal");
				});

				it('should encode -4294967296 as five bytes', () => {
					assert.equalBytesAsHex(
						new Uint8Array(CBOR.encode(-4294967296)),
						new Uint8Array([0x3A,0xFF,0xFF,0xFF,0xFF]),
						"should be equal");
				});

			});

			context("64-bit floats", () => {

				it('should encode 10000000.125 as a 64-bit floating point', () => {
					const encoded = new Uint8Array(CBOR.encode(10000000.125));
					const correct = new Uint8Array([0xFB,0x41,0x63,0x12,0xd0,0x04,0x00,0x00,0x00]);
					assert.equalBytesAsHex(encoded, correct, "should be equal");
				});

			});
			context("32-bit floats", () => {

				it('should encode 1000000.125 as a 32-bit floating point', () => {
					const encoded = new Uint8Array(CBOR.encode(1000000.125));
					const correct = new Uint8Array([0xFA,0x49,0x74,0x24,0x02]);
					assert.equalBytesAsHex(encoded, correct, "should be equal");
				});

			});
			context("16-bit floats", () => {

				it('should encode positive infinity as a 16-bit float', () => {
					assert.equalBytesAsHex(
						new Uint8Array([0xF9,0x7C,0x00]),
						new Uint8Array(CBOR.encode(Infinity)),
						"should be equal"
					);
				});

				it('should encode negative infinity as a 16-bit float', () => {
					assert.equalBytesAsHex(
						new Uint8Array(CBOR.encode(-Infinity)),
						new Uint8Array([0xF9,0xFC,0x00]),
						"should be equal"
					);
				});

				it('should encode not-a-number as a 16-bit float', () => {
					assert.equalBytesAsHex(
						new Uint8Array(CBOR.encode(NaN)),
						new Uint8Array([0xF9,0x7E,0x00]),
						"should be equal"
					);
				});


				it('should encode -0 as a 16-bit float', () => {
					assert.equalBytesAsHex(
						new Uint8Array(CBOR.encode(-0)),
						new Uint8Array([0xF9,0x80,0x00]),
						"should be equal"
					);
				});

				it('should encode 1/16777216 as a 16-bit float', () => {
					assert.equalBytesAsHex(
						new Uint8Array(CBOR.encode(1/16777216)),
						new Uint8Array([0xF9,0x00,0x01]),
						"should be equal"
					);
				});

				it('should encode 2/16777216 as a 16-bit float', () => {
					assert.equalBytesAsHex(
						new Uint8Array(CBOR.encode(2/16777216)),
						new Uint8Array([0xF9,0x00,0x02]),
						"should be equal"
					);
				});
				it('should encode 64/16777216 as a 16-bit float', () => {
					assert.equalBytesAsHex(
						new Uint8Array(CBOR.encode(64/16777216)),
						new Uint8Array([0xF9,0x00,0x40]),
						"should be equal"
					);
				});

				it('should encode 128/16777216 as a 16-bit float', () => {
					assert.equalBytesAsHex(
						new Uint8Array(CBOR.encode(128/16777216)),
						new Uint8Array([0xF9,0x00,0x80]),
						"should be equal"
					);
				});

				it('should encode 256/16777216 as a 16-bit float', () => {
					assert.equalBytesAsHex(
						new Uint8Array(CBOR.encode(256/16777216)),
						new Uint8Array([0xF9,0x01,0x00]),
						"should be equal"
					);
				});

				it('should encode 512/16777216 as a 16-bit float', () => {
					assert.equalBytesAsHex(
						new Uint8Array(CBOR.encode(512/16777216)),
						new Uint8Array([0xF9,0x02,0x00]),
						"should be equal"
					);
				});

				it('should encode 513/16777216 as a 16-bit float', () => {
					assert.equalBytesAsHex(
						new Uint8Array(CBOR.encode(513/16777216)),
						new Uint8Array([0xF9,0x02,0x01]),
						"should be equal"
					);
				});

				it('should encode 1023/16777216 as a 16-bit float', () => {
					assert.equalBytesAsHex(
						new Uint8Array(CBOR.encode(1023/16777216)),
						new Uint8Array([0xF9,0x03,0xFF]),
						"should be equal"
					);
				});

				it('should encode 768.5 as a 16-bit float', () => {
					assert.equalBytesAsHex(
						new Uint8Array(CBOR.encode(768.5)),
						new Uint8Array([0xF9,0x62,0x01]),
						"should be equal"
					);
				});

				it('should encode 1023.5 as a 16-bit float', () => {
					assert.equalBytesAsHex(
						new Uint8Array(CBOR.encode(1023.5)),
						new Uint8Array([0xF9,0x63,0xFF]),
						"should be equal"
					);
				});

				it('should encode 48.03125 as a 16-bit float', () => {
					assert.equalBytesAsHex(
						new Uint8Array(CBOR.encode(48.03125)),
						new Uint8Array([0xF9,0x52,0x01]),
						"should be equal"
					);
				});

				it('should encode 3.001953125 as a 16-bit float', () => {
					assert.equalBytesAsHex(
						new Uint8Array(CBOR.encode(3.001953125)),
						new Uint8Array([0xF9,0x42,0x01]),
						"should be equal"
					);
				});

				it('should encode 3.998046875 as a 16-bit float', () => {
					assert.equalBytesAsHex(
						new Uint8Array(CBOR.encode(3.998046875)),
						new Uint8Array([0xF9,0x43,0xFF]),
						"should be equal"
					);
				});

				it('should encode 0.333251953125 as a 16-bit float', () => {
					assert.equalBytesAsHex(
						new Uint8Array(CBOR.encode(0.333251953125)),
						new Uint8Array([0xF9,0x35,0x55]),
						"should be equal"
					);
				});
			});
		});
		context("strings", () => {

			it('should encode "test" as a utf-8 string and as explicit base-64 interpretation', () => {
				assert.equalBytesAsHex(
					new Uint8Array(CBOR.encode("test",{noExplicitConversion:true})),
					new Uint8Array([0x64,0x74,0x65,0x73,0x74]),
					"should be equal"
				);
				assert.equalBytesAsHex(
					new Uint8Array(CBOR.encode("test")),
					new Uint8Array([0xD5,0x42,0xB5,0xEB]),
					"should be equal"
				);
			});

			//noinspection SpellCheckingInspection
			it('should encode "AAAAAAA=" as an explicit conversion tagged base-64 byte array', () => {
				assert.equalBytesAsHex(
					//noinspection SpellCheckingInspection
					new Uint8Array(CBOR.encode("AAAAAAA=")),
					new Uint8Array([0xD5,0x45,0x00,0x00,0x00,0x00,0x00]),
					"should be equal"
				);
			});

			it('should encode "//////8=" as an explicit conversion tagged base-64 byte array', () => {
				assert.equalBytesAsHex(
					new Uint8Array(CBOR.encode("//////8=")),
					new Uint8Array([0xD5,0x45,0xFF,0xFF,0xFF,0xFF,0xFF]),
					"should be equal"
				);
			});

			it('should NOT encode "//////==" as an explicit conversion tagged base-64 byte array', () => {
				assert.equalBytesAsHex(
					new Uint8Array(CBOR.encode("//////==")),
					new Uint8Array([0x68,0x2F,0x2F,0x2F,0x2F,0x2F,0x2F,0x3D,0x3D]),
					"should be equal"
				);
			});

			it('should encode "/////w==" as an explicit conversion tagged base-64 byte array', () => {
				assert.equalBytesAsHex(
					new Uint8Array(CBOR.encode("/////w==")),
					new Uint8Array([0xD5,0x44,0xFF,0xFF,0xFF,0xFF]),
					"should be equal"
				);
			});

			it('should encode "0000" as an explicit conversion tagged base-16 byte array', () => {
				assert.equalBytesAsHex(
					new Uint8Array(CBOR.encode("0000")),
					new Uint8Array([0xD7,0x42,0x00,0x00]),
					"should be equal"
				);
			});

			it('should encode "5AA5" as an explicit conversion tagged base-16 byte array', () => {
				assert.equalBytesAsHex(
					new Uint8Array(CBOR.encode("5AA5")),
					new Uint8Array([0xD7,0x42,0x5A,0xA5]),
					"should be equal"
				);
			});

			//noinspection SpellCheckingInspection
			it('should encode "FFFF" as an explicit conversion tagged base-16 byte array', () => {
				assert.equalBytesAsHex(
					//noinspection SpellCheckingInspection
					new Uint8Array(CBOR.encode("FFFF")),
					new Uint8Array([0xD7,0x42,0xFF,0xFF]),
					"should be equal"
				);
			});
			it('should encode "this is a test \u1234" as a utf-8 string', () => {
				assert.equalBytesAsHex(
					new Uint8Array(CBOR.encode("this is a test \u1234")),
					new Uint8Array([0x72,
						0x74,0x68,0x69,0x73, // "this"
						0x20, // space
						0x69,0x73, // "is"
						0x20, // space
						0x61, // "a"
						0x20, // space
						0x74,0x65,0x73,0x74, // "test"
						0x20, // space
						0xE1,0x88,0xB4 // "\u1234"
					]),
					"should be equal"
				);
			});
			it('should encode "\u{2F804}" as a utf-8 string', () => {
				assert.equalBytesAsHex(
					new Uint8Array(CBOR.encode("\u{2F804}")),
					new Uint8Array([0x64,
						0xF0,0xAF,0xA0,0x84 // "\u{2F804}"
					]),
					"should be equal"
				);
			});
			it('should encode "\u{10FFFF}" as a utf-8 string', () => {
				assert.equalBytesAsHex(
					new Uint8Array(CBOR.encode("\u{10FFFF}")),
					new Uint8Array([0x64,
						0xF4,0x8F,0xBF,0xBF
					]),
					"should be equal"
				);
			});
			it('should encode "\x81" as a utf-8 string', () => {
				assert.equalBytesAsHex(
					new Uint8Array(CBOR.encode("\x81")),
					new Uint8Array([0x62,
						0xC2,0x81 // "\u{81}"
					]),
					"should be equal"
				);
			});
		});

		context("binary", () => {

			it('should encode new Uint8Array([1,2,3]) as a byte array in 4 bytes', () => {
				const encoded = new Uint8Array(CBOR.encode(new Uint8Array([1,2,3])));
				const correct = new Uint8Array([0x43,0x01,0x02,0x03]);
				assert.equalBytesAsHex(encoded, correct, "should be equal");
			});

			it('should encode new Int8Array([1,2,3]) as a byte array in 6 bytes', () => {
				const encoded = new Uint8Array(CBOR.encode(new Int8Array([1,2,3])));
				const correct = new Uint8Array([0xD8,0x81,0x43,0x01,0x02,0x03]);
				assert.equalBytesAsHex(encoded, correct, "should be equal");
			});

			it('should encode new Uint8Array([1,2,3]).buffer as a byte array in 6 bytes', () => {
				const encoded = new Uint8Array(CBOR.encode(new Uint8Array([1,2,3]).buffer));
				const correct = new Uint8Array([0xD8,0x82,0x43,0x01,0x02,0x03]);
				assert.equalBytesAsHex(encoded, correct, "should be equal");
			});


		});

		context("arrays", () => {

			it('should encode [1,2,3] as an array in 4 bytes', () => {
				const encoded = new Uint8Array(CBOR.encode([1,2,3]));
				const correct = new Uint8Array([0x83,0x01,0x02,0x03]);
				assert.equalBytesAsHex(encoded, correct, "should be equal");
			});

			it('should encode new Set([1,2,3]) as a tagged map in 6 bytes', () => {
				const encoded = new Uint8Array(CBOR.encode(new Set([1,2,3])));
				const correct = new Uint8Array([0xD8,0x80,0x83,0x01,0x02,0x03]);
				assert.equalBytesAsHex(encoded, correct, "should be equal");
			});
		});
		context("objects", () => {

			it('should encode {"1":2,"3":4} as a map in 5 bytes', () => {
				const encoded = new Uint8Array(CBOR.encode({"1":2,"3":4}));
				const correct = new Uint8Array([0xA2,0x01,0x02,0x03,0x04]);
				assert.equalBytesAsHex(encoded, correct, "should be equal");
			});

			it('should encode {1:2,3:4} as a map in 5 bytes', () => {
				const encoded = new Uint8Array(CBOR.encode({1:2,3:4}));
				const correct = new Uint8Array([0xA2,0x01,0x02,0x03,0x04]);
				assert.equalBytesAsHex(encoded, correct, "should be equal");
			});

			it('should encode {a:1,b:2} as a map in 7 bytes', () => {
				const encoded = new Uint8Array(CBOR.encode({a:2,b:4}));
				const correct = new Uint8Array([0xA2,0x61,0x61,0x02,0x61,0x62,0x04]);
				assert.equalBytesAsHex(encoded, correct, "should be equal");
			});

			it('should encode new Map([[1,2],[3,4]]) as a tagged map in 7 bytes', () => {
				const encoded = new Uint8Array(CBOR.encode(new Map([[1,2],[3,4]])));
				const correct = new Uint8Array([0xD8,0x7F,0xA2,0x01,0x02,0x03,0x04]);
				assert.equalBytesAsHex(encoded, correct, "should be equal");
			});

			it('should encode new Date(0) as a tagged integer in 2 bytes', () => {
				const encoded = new Uint8Array(CBOR.encode(new Date(0)));
				const correct = new Uint8Array([0xC1,0x00]);
				assert.equalBytesAsHex(encoded, correct, "should be equal");
			});

			it('should encode /test/g as a tagged tagged string in bytes', () => {
				const encoded = new Uint8Array(CBOR.encode(/test/g));
				const correct = new Uint8Array([0xD8,0x23,0x67,0x2F,0x74,0x65,0x73,0x74,0x2F,0x67]);
				assert.equalBytesAsHex(encoded, correct, "should be equal");
			});
		});

		context("symbols", () => {

			it('should encode Symbol("test") as a string in 6 bytes', () => {
				const encoded = new Uint8Array(CBOR.encode(Symbol("test")));
				const correct = new Uint8Array([
					0xD8,0x8E, // tag 142
					0x6C, // text 12
					0x53,0x79,0x6D,0x62,0x6F,0x6C,0x28, // "Symbol("
					0x74,0x65,0x73,0x74, //"test"
					0x29]); // ")"
				assert.equalBytesAsHex(encoded, correct, "should be equal");
			});

			it('should encode Symbol.for("test") as a string in 6 bytes', () => {
				const encoded = new Uint8Array(CBOR.encode(Symbol.for("test")));
				const correct = new Uint8Array([
					0xD8,0x8D, // tag 141
					0x70, // text 16
					0x53,0x79,0x6d,0x62,0x6f,0x6c,0x2e,0x66,0x6f,0x72,0x28, // "Symbol.for("
					0x74,0x65,0x73,0x74, //"test"
					0x29]); // ")"
				assert.equalBytesAsHex(encoded, correct, "should be equal");
			});


			it('should encode Symbol.iterator as a simple value in 2 bytes', () => {
				const encoded = new Uint8Array(CBOR.encode(Symbol.iterator));
				const correct = new Uint8Array([0xF8,0x20]);
				assert.equalBytesAsHex(encoded, correct, "should be equal");
			});

			it('should encode Symbol.match as a simple value in 2 bytes', () => {
				const encoded = new Uint8Array(CBOR.encode(Symbol.match));
				const correct = new Uint8Array([0xF8,0x21]);
				assert.equalBytesAsHex(encoded, correct, "should be equal");
			});

			it('should encode Symbol.replace as a simple value in 2 bytes', () => {
				const encoded = new Uint8Array(CBOR.encode(Symbol.replace));
				const correct = new Uint8Array([0xF8,0x22]);
				assert.equalBytesAsHex(encoded, correct, "should be equal");
			});

			it('should encode Symbol.search as a simple value in 2 bytes', () => {
				const encoded = new Uint8Array(CBOR.encode(Symbol.search));
				const correct = new Uint8Array([0xF8,0x23]);
				assert.equalBytesAsHex(encoded, correct, "should be equal");
			});

			it('should encode Symbol.split as a simple value in 2 bytes', () => {
				const encoded = new Uint8Array(CBOR.encode(Symbol.split));
				const correct = new Uint8Array([0xF8,0x24]);
				assert.equalBytesAsHex(encoded, correct, "should be equal");
			});

			it('should encode Symbol.hasInstance as a simple value in 2 bytes', () => {
				const encoded = new Uint8Array(CBOR.encode(Symbol.hasInstance));
				const correct = new Uint8Array([0xF8,0x25]);
				assert.equalBytesAsHex(encoded, correct, "should be equal");
			});

			it('should encode Symbol.isConcatSpreadable as a simple value in 2 bytes', () => {
				const encoded = new Uint8Array(CBOR.encode(Symbol.isConcatSpreadable));
				const correct = new Uint8Array([0xF8,0x26]);
				assert.equalBytesAsHex(encoded, correct, "should be equal");
			});

			it('should encode Symbol.unscopables as a simple value in 2 bytes', () => {
				const encoded = new Uint8Array(CBOR.encode(Symbol.unscopables));
				const correct = new Uint8Array([0xF8,0x27]);
				assert.equalBytesAsHex(encoded, correct, "should be equal");
			});

			it('should encode Symbol.species as a simple value in 2 bytes', () => {
				if ( Symbol.species === undefined )
					throw new Error('Symbol.species is undefined');
				const encoded = new Uint8Array(CBOR.encode(Symbol.species));
				const correct = new Uint8Array([0xF8,0x28]);
				assert.equalBytesAsHex(encoded, correct, "should be equal");
			});


			it('should encode Symbol.toPrimitive as a simple value in 2 bytes', () => {
				const encoded = new Uint8Array(CBOR.encode(Symbol.toPrimitive));
				const correct = new Uint8Array([0xF8,0x29]);
				assert.equalBytesAsHex(encoded, correct, "should be equal");
			});

			it('should encode Symbol.toStringTag as a simple value in 2 bytes', () => {
				const encoded = new Uint8Array(CBOR.encode(Symbol.toStringTag));
				const correct = new Uint8Array([0xF8,0x2A]);
				assert.equalBytesAsHex(encoded, correct, "should be equal");
			});
		});


		context("booleans", () => {
			it('should encode false as 1 byte', () => {
				const encoded = new Uint8Array(CBOR.encode(false));
				const correct = new Uint8Array([0xF4]);
				assert.equalBytesAsHex(encoded, correct, "should be equal");
			});

			it('should encode true as 1 byte', () => {
				const encoded = new Uint8Array(CBOR.encode(true));
				const correct = new Uint8Array([0xF5]);
				assert.equalBytesAsHex(encoded, correct, "should be equal");
			});
		});

		context("absents", () => {
			it('should encode null as 1 byte', () => {
				const encoded = new Uint8Array(CBOR.encode(null));
				const correct = new Uint8Array([0xF6]);
				assert.equalBytesAsHex(encoded, correct, "should be equal");
			});

			it('should encode undefined as 1 byte', () => {
				const encoded = new Uint8Array(CBOR.encode(undefined));
				const correct = new Uint8Array([0xF7]);
				assert.equalBytesAsHex(encoded, correct, "should be equal");
			});
		});
	});
});

if ( typeof mocha !== 'undefined' )
	mocha.run();
