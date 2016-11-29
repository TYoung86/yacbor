(function cbor() {
	"use strict";
	const root = typeof global === 'undefined' ? this : global;
	const Buffer = root.Buffer;
	const TextDecoder = root.TextDecoder;

	/**
	 * @export
	 */
	function CBOR() { throw new Error("CBOR is a namespace."); }

	const optionDescriptions = Object.freeze(Object.setPrototypeOf({
		dryRun: "No transcoding will be performed, only the length of the encoded size will be returned.",
		selfDescribing: "The encoded result will begin with the CBOR self-description tag. (Larger output)",
		noExplicitConversion: "Explicit conversion will not be performed. (Larger output)",
		minExplicitConvSize: "A minimum size before attempting automatic explicit conversions. (Larger values mean larger output)",
		explicitConvertLowerCaseHex: "Use custom explicit conversion tags for lowercase base 16 encoding. (Smaller output, Non-standard)",
		backReferences: "Back references will be used for repeating or recursive arrays and objects. (Smaller output, Non-standard)",
		smallBackReferences: "Back references will be used for repeating small values. (Elements that consume 4 to 8 bytes, Non-standard)",
		allNumbersAreDoubles: "Encode all numbers as 8-byte double-precision floating point numbers. (Reduce encoder complexity)",
		allowRemainingBytes: "Allow additional bytes beyond the indicated end of the CBOR element.",
		doNotTagTypedArrays: "If not set, typed arrays will be tagged to allow their proper decoding. (More correct, larger output)",
		doNotTagBoxedValues: "If not set, boxed values will be tagged to allow their proper decoding. (More correct, larger output)",
		doNotThrow: "No exceptions will be thrown, an incomplete CBOR element will be returned on exception.",
		destinationBuffer: "The buffer to write the encoded element to. If not provided, one will be created.",
		indefiniteStringNonStrings: "Allow indefinite strings to be composed of non-string types. (Non-standard)",
		decomposedStrings: "Construct strings using non-string types and conversion tags. (Needs indefiniteStringNonStrings)", // not yet implemented
		throwOnUnsupportedTag: "Specifies if an error should be thrown upon encountering an unknown tag.",
		throwOnUnsupportedSimpleValue: "Specifies if an error should be thrown upon encountering an unknown simple value.",
		encodeDatesAsStrings: "Encode all dates as strings with appropriate tagging instead of numbers. (Larger output)",
		unknownSimpleValueParser: "A function that decodes an unknown simple value given the context.",
		unknownTagParser: "A function that decodes an unknown tag given the context.",
	}, null));

	const POW_2_24 = 1<<24;
	const POW_2_32 = Math.pow(2, 32);

	/** @type {Object} */
	const emptyObject = Object.freeze(Object.create(null));
	//noinspection JSValidateTypes

	///** @type {Array} */
	//const emptyArray = Object.freeze([]);

	//noinspection JSValidateTypes
	/** @type {Uint8Array} */
	const emptyByteArray = Object.freeze(new Uint8Array(0));

	function NonCodingIndicator() {}
	NonCodingIndicator.prototype = Object.create(null);
	NonCodingIndicator.instance = new NonCodingIndicator();
	Object.freeze(NonCodingIndicator);
	Object.freeze(NonCodingIndicator.prototype);
	Object.freeze(NonCodingIndicator.instance);

	function SelfDescribingIndicator() {}
	SelfDescribingIndicator.prototype = NonCodingIndicator.instance;
	SelfDescribingIndicator.instance = new SelfDescribingIndicator();
	Object.freeze(SelfDescribingIndicator);
	Object.freeze(SelfDescribingIndicator.prototype);
	Object.freeze(SelfDescribingIndicator.instance);

	function ErrorIndicator() {}
	ErrorIndicator.prototype = NonCodingIndicator.instance;
	ErrorIndicator.instance = new ErrorIndicator();
	Object.freeze(ErrorIndicator);
	Object.freeze(ErrorIndicator.prototype);
	Object.freeze(ErrorIndicator.instance);

	function BreakIndicator() {}
	BreakIndicator.prototype = NonCodingIndicator.instance;
	BreakIndicator.instance = new BreakIndicator();
	Object.freeze(BreakIndicator);
	Object.freeze(BreakIndicator.prototype);
	Object.freeze(BreakIndicator.instance);

	function TagIndicator() {}
	TagIndicator.prototype = NonCodingIndicator.instance;
	TagIndicator.instance = new TagIndicator();
	Object.freeze(TagIndicator);
	Object.freeze(TagIndicator.prototype);
	Object.freeze(TagIndicator.instance);

	const nonCodingIndicator = NonCodingIndicator.instance;
	const selfDescribingIndicator = SelfDescribingIndicator.instance;
	const errorIndicator = ErrorIndicator.instance;
	const breakIndicator = BreakIndicator.instance;
	const tagIndicator = TagIndicator.instance;

	class UnknownSimpleValue {
		constructor(value) { this.value = value; }
		valueOf() { return this.value; }
	}

	const regExpForRegExps = /^\/((?:.*?(?!\\).)?)\/(.*)$/;
	const regExpForUniqueSymbols = /^Symbol\((.*)\)$/;
	const regExpForSharedSymbols = /^Symbol\.for\((.*)\)$/;

	const smallBuffer = new ArrayBuffer(8);
	//noinspection JSCheckFunctionSignatures // broken signature check
	const smallBufferFloat64 = new Float64Array(smallBuffer, 0, 1);
	const smallBufferFloat32 = new Float32Array(smallBuffer, 0, 1);
	const smallBufferUint32 = new Uint32Array(smallBuffer, 0, 1);
	const smallBuffer8Bytes = new Uint8Array(smallBuffer, 0, 8);
	const smallBuffer4Bytes = new Uint8Array(smallBuffer, 0, 4);



	/**
	 * object helper function
	 * @param object
	 * @returns {boolean}
	 * @constructor
	 */
	function Object_isEmpty(object) {
		//noinspection LoopStatementThatDoesntLoopJS
		for(const b in a) {
			return false;
		}
		return true;
	}

	const HALF_EPSILON = (Number.EPSILON/2);
	const ONE_MINUS_HALF_EPSILON = 1 - HALF_EPSILON;

	/**
	 * math sign helper function that doesn't de-optimize
	 * NOTE: does not return 0 if value is 0
	 * @param {number} value
	 * @returns {number}
	 */
	function Math_sign_fast(value) {
		return ( value >> 31 ) | 1;
	}

	/**
	 * math ceiling helper function that doesn't de-optimize
	 * NOTE: assumes value is absolute, fails on large values
	 * @param {number} value
	 * @returns {number}
	 */
	function Math_ceilOfAbs(value) {
		return Math_floorOfAbs((Math_sign_fast(value) * ONE_MINUS_HALF_EPSILON) + value);
	}

	/**
	 * math floor helper function that doesn't de-optimize
	 * NOTE: assumes value is absolute, fails on large values
	 * @param {number} value
	 * @returns {number}
	 */
	function Math_floorOfAbs(value) {
		return value >>> 0;
	}




	/**
	 * helper method that gets the byte length given the base 64 character count
	 * @param {number} encodedChars
	 * @returns {number}
	 */
	function getBase64DecodedLength(encodedChars) {
		return encodedChars - Math_ceilOfAbs(encodedChars / 4);
	}

	/**
	 * helper method that gets the base 64 character count given the byte length
	 * @param {number} byteLength
	 * @returns {number}
	 */
	function getBase64EncodedCharCount(byteLength) {
		return byteLength + Math_ceilOfAbs(byteLength / 3);
	}

	/**
	 * helper method that accounts for the padding in base 64 character length
	 * @param {number} charCount
	 * @returns {number}
	 */
	function getBase64EncodedLengthFromCharCount(charCount) {
		return ( (charCount + 3) >>> 2 ) * 4;
	}

	/**
	 * helper method that gets the byte length of a utf-8 string
	 * @param {string} string
	 * @returns {number}
	 */
	function getByteLengthOfUtf8String(string) {
		const charLength = string.length;
		let byteLength = 0;
		let codePoint = 0;
		for (let i = 0; i < charLength; ++i ) {
			codePoint = string.codePointAt(i);
			if (codePoint < 0x80) {
				byteLength = byteLength + (1);
				i = i + 1;
			} else if (codePoint < 0x800) {
				byteLength = byteLength + (2);
				i = i + 1;
			} else if (codePoint < 0xd800) {
				byteLength = byteLength + (3);
				i = i + 1;
			} else {
				byteLength = byteLength + (4);
				i = i + 2;
			}
		}
		return byteLength;
	}

	/**
	 * helper method that counts the actual base 64 characters of a base 64 string
	 * @param {string} string
	 * @returns {number}
	 */
	function getBase64CharCount(string) {
		let strLength = string.length;
		return string.codePointAt(strLength - 2) === 61
			? strLength - 2
			: string.codePointAt(strLength - 1) === 61
			       ? strLength - 1
			       : strLength;
	}

	/**
	 * helper method that gets the byte length of a base 64 string
	 * @param {string} string
	 * @returns {number}
	 */
	function getBase64StringByteLength(string) {
		return getBase64DecodedLength(getBase64CharCount(string));
	}

	/**
	 * helper method that gets the byte length of a hexadecimal string
	 * @param {string} string
	 * @returns {number}
	 */
	function getHexStringByteLength(string) {
		return string.length >>> 1;
	}

	const rxUpperCaseHexString = /^[0-9A-F]+$/;
	const rxLowerCaseHexString = /^[0-9a-f]+$/;

	/**
	 *
	 * @param {string} string
	 * @returns {number}
	 */
	function detectHexString(string) {
		if (string.length === 0 || (string.length & 1) !== 0)
			return 0;
		if (rxUpperCaseHexString.exec(string) !== null)
			return 1;
		if (rxLowerCaseHexString.exec(string) !== true)
			return -1;
		return 0;
	}

	/**
	 * upper or lower, doesn't care.
	 * @param {string} string
	 * @param {Uint8Array} byteView
	 * @param {Object} state
	 * @param {Object} options
	 * @returns {number}
	 */
	function encodeHexStringAsBytes(string, byteView, state, options) {
		let strLength = string.length;
		if ((strLength & 1) !== 0)
			throw new Error("Hexadecimal strings must be of an even number of characters.");
		if (options.dryRun === true) {
			state.offset = state.offset + (strLength >>> 1);
			return strLength >>> 1;
		}
		for (let i = 0; i < strLength; i += 2) {
			let ch1 = string.codePointAt(i);
			let ch2 = string.codePointAt(i + 1);
			byteView[state.offset++] =
				(((ch1 & 0xF) + ( ch1 > 0x39 ? 0x9 : 0 )) << 4) |
				(ch2 & 0xF) + ( ch2 > 0x39 ? 0x9 : 0 );
		}
		return strLength >>> 1;
	}

	const upperCaseLetterDiff = ('A'.codePointAt(0) - '9'.codePointAt(0)) - 1;
	const lowerCaseLetterDiff = ('a'.codePointAt(0) - '9'.codePointAt(0)) - 1;

	/**
	 *
	 * @param {number} byteLength
	 * @param {Uint8Array} byteView
	 * @param {Object} state
	 * @param {Object} options
	 * @returns {string}
	 */
	function decodeBytesAsHexString(byteLength, byteView, state, options) {
		if (options.dryRun === true) {
			state.offset = state.offset + (byteLength);
			return "";
		}
		const letterDiff = state.hexLowerCase === true ? lowerCaseLetterDiff : upperCaseLetterDiff;
		const letters = new Uint8Array(byteLength * 2);
		for (let i = 0; i < byteLength; ++i) {
			let byte = byteView[state.offset + i];
			let cv1 = (byte >>> 4) + 0x30;
			let cv2 = (byte & 0xF) + 0x30;
			if (cv1 > 0x39) cv1 = cv1 + (letterDiff);
			if (cv2 > 0x39) cv2 = cv2 + (letterDiff);
			const li = i * 2;
			letters[li] = cv1;
			letters[li + 1] = cv2;
		}
		return String.fromCharCode.apply(null, letters);
	}



	const rxBase64 = /^(?:[A-Za-z0-9+\/]{4})*(?:|[A-Za-z0-9+\/][AQgw]==|[A-Za-z0-9+\/]{2}[AEIMQUYcgkosw048]=)$/;
	const rxBase64Url = /^(?:[A-Za-z0-9\-_]{4})*(?:|[A-Za-z0-9\-_][AQgw]|[A-Za-z0-9+\/]{2}[AEIMQUYcgkosw048])$/;

	/**
	 *
	 * @param {string} string
	 * @returns {number}
	 */
	function detectBase64String(string) {
		if (string.length === 0)
			return 0;
		if (rxBase64.exec(string) !== null)
			return 1;
		if (rxBase64Url.exec(string) !== null)
			return 2;
		return 0;
	}

	const base64ValueToCharLookup = new Uint8Array(64);
	const base64UrlValueToCharLookup = new Uint8Array(64);
	const base64CharToValueLookup = new Uint8Array(123 - 43);

	function initBase64Lookups() {
		//noinspection SpellCheckingInspection
		const charset = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
		let codePoint = 0;
		for (let i = 0; i < 64; ++i) {
			codePoint = charset.codePointAt(i);
			base64CharToValueLookup[codePoint - 43] = i;
			base64ValueToCharLookup[i] = codePoint;
		}
		base64UrlValueToCharLookup.set(base64ValueToCharLookup, 0);
		const dashCharCode = '-'.codePointAt(0);
		const underscoreCharCode = '_'.codePointAt(0);
		base64UrlValueToCharLookup[62] = dashCharCode;
		base64UrlValueToCharLookup[63] = underscoreCharCode;
		base64CharToValueLookup[dashCharCode] = 62;
		base64CharToValueLookup[underscoreCharCode] = 63;
	}

	function getBase64CharValue(charCode) {
		return base64CharToValueLookup[charCode - 43] | 0;
	}

	/**
	 *
	 * @param {string} string
	 * @param {Uint8Array} byteView
	 * @param {Object} state
	 * @param {Object} options
	 * @returns {number}
	 */
	function encodeBase64StringAsBytes(string, byteView, state, options) {
		const charLength = getBase64CharCount(string);
		const byteLength = getBase64DecodedLength(charLength);
		if (options.dryRun === true) {
			state.offset = state.offset + (byteLength);
			return byteLength;
		}
		const end = state.offset + byteLength;
		let cv1 = 0;
		let cv2 = 0;
		let cv3 = 0;
		let cv4 = 0;
		let threeBytes = 0;
		for (let i = 0; i < charLength; i = i + 4) {
			cv1 = getBase64CharValue(string.codePointAt(i));
			cv2 = getBase64CharValue(string.codePointAt(i + 1));
			cv3 = getBase64CharValue(string.codePointAt(i + 2));
			cv4 = getBase64CharValue(string.codePointAt(i + 3));
			threeBytes = (cv1 << 18) + (cv2 << 12) + (cv3 << 6) + cv4;

			if (state.offset < end)
				byteView[state.offset++] = threeBytes >>> 16;
			else break;
			if (state.offset < end)
				byteView[state.offset++] = threeBytes >>> 8;
			else break;
			if (state.offset < end)
				byteView[state.offset++] = threeBytes;
			else break;
		}
		return byteLength;
	}

	/**
	 *
	 * @param {Uint8Array} byteView
	 * @param {Object} state
	 * @param {number} byteLength
	 * @param {Object} options
	 * @returns {string}
	 */
	function decodeBytesAsBase64String(byteView, state, byteLength, options) {
		if (byteLength === 0) return "";
		const end = state.offset + byteLength;
		const charCount = getBase64EncodedCharCount(byteLength);
		const charBufferSize = state.base64Url === true
			? charCount
			: getBase64EncodedLengthFromCharCount(charCount);
		if (options.dryRun === true) {
			state.offset = state.offset + (charBufferSize);
			return "";
		}
		const charBuffer = new Uint8Array(charBufferSize);
		let carryBuffer = 0;
		let charBufIdx = 0;
		let byteCounter = 0;
		const charLookup = state.base64Url === true ? base64UrlValueToCharLookup : base64ValueToCharLookup;
		while (state.offset <= end) {
			switch (byteCounter++ % 3) {
				default:
				case 0: {
					carryBuffer = byteView[state.offset++];
					charBuffer[charBufIdx++] = charLookup[carryBuffer >>> 2];
					break;
				}
				case 1: {
					carryBuffer <<= 8;
					carryBuffer = carryBuffer | (byteView[state.offset++]);
					charBuffer[charBufIdx++] = charLookup[(carryBuffer >>> 4) & 0x3f];
					break;
				}
				case 2: {
					carryBuffer <<= 8;
					carryBuffer = carryBuffer | (byteView[state.offset++]);
					charBuffer[charBufIdx++] = charLookup[(carryBuffer >>> 6) & 0x3f];
					charBuffer[charBufIdx++] = charLookup[carryBuffer & 0x3f];
					break;
				}
			}
		}
		if (state.base64Url !== true) {
			const charAlignment4 = charCount & 3;
			if (charAlignment4 === 2) {
				charBuffer[charBufferSize - 2] = 61;
				charBuffer[charBufferSize - 1] = 61;
			} else if (charAlignment4 === 3)
				charBuffer[charBufferSize - 1] = 61;
		}

		return String.fromCharCode.apply(null, charBuffer);
	}


	/**
	 *
	 * @function
	 * @param {string} string
	 * @param {Uint8Array} byteView
	 * @param {Object} state
	 * @param {Object} options
	 * @returns {number}
	 */
	let encodeUtf8StringAsBytes;
	/**
	 *
	 * @function
	 * @param {Uint8Array} byteView
	 * @param {Object} state
	 * @param {number} byteLength
	 * @param {Object} options
	 * @returns {string}
	 */
	let decodeBytesAsUtf8String;

	/**
	 * initialize the utf-8 encoder and decoder
	 */
	function initUtf8Codec() {


		/**
		 *
		 * @param {string} string
		 * @param {Uint8Array} byteView
		 * @param {Object} state
		 * @param {Object} options
		 * @returns {number}
		 */
		function encodeUtf8StringAsBytesJS(string, byteView, state, options) {
			if (options.dryRun === true) {
				const size = getByteLengthOfUtf8String(string);
				state.offset = state.offset + (size);
				return size;
			}
			const start = state.offset;
			const charLength = string.length;
			let codePoint = 0;
			for (let i = 0; i < charLength; ++i) {
				codePoint = string.codePointAt(i);
				if (codePoint < 0x80) {
					byteView[state.offset++] = codePoint;
				} else if (codePoint < 0x800) {
					byteView[state.offset++] = (0xc0 | codePoint >>> 6);
					byteView[state.offset++] = (0x80 | codePoint & 0x3f);
				} else if (codePoint < 0xd800) {
					byteView[state.offset++] = (0xe0 | codePoint >>> 12);
					byteView[state.offset++] = (0x80 | (codePoint >>> 6) & 0x3f);
					byteView[state.offset++] = (0x80 | codePoint & 0x3f);
				} else {
					byteView[state.offset++] = (0xf0 | codePoint >>> 18);
					byteView[state.offset++] = (0x80 | (codePoint >>> 12) & 0x3f);
					byteView[state.offset++] = (0x80 | (codePoint >>> 6) & 0x3f);
					byteView[state.offset++] = (0x80 | codePoint & 0x3f);
					++i;
				}
			}
			return state.offset - start;
		}

		/**
		 *
		 * @param {Uint8Array} byteView
		 * @param {Object} state
		 * @param {number} byteLength
		 * @param {Object} options
		 * @returns {string}
		 */
		function decodeBytesAsUtf8StringJS(byteView, state, byteLength, options) {
			if (options.dryRun === true) {
				state.offset = state.offset + byteLength;
				return "";
			}

			const end = state.offset + byteLength;

			let offset = state.offset;

			let string = "";

			let charLength = 0;
			let codePoint = 0;
			while (offset < end) {
				codePoint = byteView[offset];
				if (codePoint < 0x80) {
					string += String.fromCodePoint( codePoint );
					charLength = charLength + (1);
					offset = offset + (1);
				} else if (codePoint < 0xe0) {
					string += String.fromCodePoint( codePoint );
					charLength = charLength + (1);
					offset = offset + (2);
				} else if (codePoint < 0xf0) {
					const fullCodePoint = (codePoint & 0x0f) << 12
						| (byteView[offset + 1] & 0x3f) << 6
						| (byteView[offset + 2] & 0x3f);
					string += String.fromCodePoint( fullCodePoint );
					charLength = charLength + (fullCodePoint < 0x10000 ? 1 : 2);
					offset = offset + (3);
				} else {
					const fullCodePoint = ((codePoint & 0x07) << 18
						| (byteView[offset + 1] & 0x3f) << 12
						| (byteView[offset + 2] & 0x3f) << 6
						| (byteView[offset + 3] & 0x3f))
						- 0x10000;
					string += String.fromCodePoint( fullCodePoint );
					charLength = charLength + (2);
					offset = offset + (4);
				}
			}

			state.offset = offset;

			return string;
		}


		/**
		 * @name TextDecoder
		 * @function
		 * @global
		 * @param {string} codec
		 */
		let textDecoder = undefined;

		/**
		 *
		 * @param {string} string
		 * @param {Uint8Array} byteView
		 * @param {Object} state
		 * @param {Object} options
		 * @returns {number}
		 */
		function encodeUtf8StringAsBytesNode(string, byteView, state, options) {
			const byteLength = getByteLengthOfUtf8String(string);
			if (options.dryRun === true) {
				state.offset = state.offset + byteLength;
				return byteLength;
			}
			const offset = byteView.byteOffset + state.offset;
			state.offset = state.offset + byteLength;
			const buf = Buffer.from(byteView.buffer, offset, byteLength);
			return buf.write(string, 0, byteLength, 'utf8');
		}

		/**
		 *
		 * @param {Uint8Array} byteView
		 * @param {Object} state
		 * @param {number} byteLength
		 * @param {Object} options
		 * @returns {string}
		 */
		function decodeBytesAsUtf8StringNode(byteView, state, byteLength, options) {
			if (options.dryRun === true) {
				state.offset = state.offset + byteLength;
				return "";
			}
			const offset = byteView.byteOffset + state.offset;
			const result = Buffer.from(byteView.buffer, offset, byteLength).toString('utf8');
			state.offset = state.offset + byteLength;
			return result;
		}

		/**
		 *
		 * @param {Uint8Array} byteView
		 * @param {Object} state
		 * @param {number} byteLength
		 * @param {Object} options
		 * @returns {string}
		 */
		function decodeBytesAsUtf8StringNative(byteView, state, byteLength, options) {
			if (options.dryRun === true) {
				state.offset = state.offset + byteLength;
				return "";
			}
			const offset = byteView.byteOffset + state.offset;
			const result = textDecoder.decode(new DataView(byteView.buffer, offset, byteLength));
			state.offset = state.offset + byteLength;
			return result;
		}

		if (Buffer !== undefined) {
			encodeUtf8StringAsBytes = encodeUtf8StringAsBytesNode;
			decodeBytesAsUtf8String = decodeBytesAsUtf8StringNode;
		} else if (TextDecoder !== undefined) {
			textDecoder = new TextDecoder('utf-8');
			encodeUtf8StringAsBytes = encodeUtf8StringAsBytesJS;
			decodeBytesAsUtf8String = decodeBytesAsUtf8StringNative;
		} else {
			encodeUtf8StringAsBytes = encodeUtf8StringAsBytesJS;
			decodeBytesAsUtf8String = decodeBytesAsUtf8StringJS;
		}
	}

	/**
	 *
	 * @param {number} value
	 * @param {Uint8Array} byteView
	 * @param {Object} state
	 * @param {Object} options
	 */
	function encodeDouble(value, byteView, state, options) {
		if (options.dryRun === true) {
			state.offset = state.offset + (9);
			return;
		}
		byteView[state.offset] = 0xfb; // fp64
		smallBufferFloat64[0] = value;
		// byteView.set(smallBuffer8Bytes, state.offset + 1); // LE
		byteView[state.offset + 1] = smallBuffer8Bytes[7];
		byteView[state.offset + 2] = smallBuffer8Bytes[6];
		byteView[state.offset + 3] = smallBuffer8Bytes[5];
		byteView[state.offset + 4] = smallBuffer8Bytes[4];
		byteView[state.offset + 5] = smallBuffer8Bytes[3];
		byteView[state.offset + 6] = smallBuffer8Bytes[2];
		byteView[state.offset + 7] = smallBuffer8Bytes[1];
		byteView[state.offset + 8] = smallBuffer8Bytes[0];
		state.offset = state.offset + (9);
	}

	function encodeInteger(positive, encodedValue, byteView, state, options) {
		if (encodedValue < 24) {
			if (options.dryRun === true) {
				state.offset = state.offset + (1);
			} else {
				if (positive) {
					byteView[state.offset] = encodedValue;
				} else {
					byteView[state.offset] = 0x20 | encodedValue;
				}
				state.offset = state.offset + (1);
			}
		} else if (encodedValue <= 0xff) {
			if (options.dryRun === true) {
				state.offset = state.offset + (2);
			} else {
				if (positive) {
					byteView[state.offset] = 0x18;
				} else {
					byteView[state.offset] = 0x38;
				}
				byteView[state.offset + 1] = encodedValue;
				state.offset = state.offset + (2);
			}
		} else if (encodedValue <= 0xffff) {
			if (options.dryRun === true) {
				state.offset = state.offset + (3);
			} else {
				if (positive) {
					byteView[state.offset] = 0x19;
				} else {
					byteView[state.offset] = 0x39;
				}
				byteView[state.offset + 1] = encodedValue >>> 8;
				byteView[state.offset + 2] = encodedValue & 0xff;
				state.offset = state.offset + (3);
			}
		} else {
			if (options.dryRun === true) {
				state.offset = state.offset + (5);
			} else {
				if (positive) {
					byteView[state.offset] = 0x1a;
				} else {
					byteView[state.offset] = 0x3a;
				}
				byteView[state.offset + 1] = encodedValue >>> 24;
				byteView[state.offset + 2] = encodedValue >>> 16;
				byteView[state.offset + 3] = encodedValue >>> 8;
				byteView[state.offset + 4] = encodedValue;
				state.offset = state.offset + (5);
			}
			// 64-bit ints are pointless to encode in JS currently
		}
	}

	/**
	 *
	 * @param {number} value
	 * @param {Uint8Array} byteView
	 * @param {Object} state
	 * @param {Object} options
	 */
	function encodeNumber(value, byteView, state, options) {
		if (options.allNumbersAreDoubles === true) {
			encodeDouble(value, byteView, state, options);
			return;
		}
		if (!isFinite(value)) {
			if (options.dryRun === true) {
				state.offset = state.offset + (3);
				return;
			}
			byteView[state.offset] = 0xf9; // fp16
			if (isNaN(value)) {
				byteView[state.offset + 1] = 0x7e; // NaN
			} else if (value > 0) {
				byteView[state.offset + 1] = 0x7c; // +Inf
			} else {
				byteView[state.offset + 1] = 0xfc; // -Inf
			}
			byteView[state.offset + 2] = 0;
			state.offset = state.offset + (3);
			return;
		}
		const zero = value === 0;
		const positive = ( zero && 1 / value > 0 ) || value > 0;
		const negZero = zero && positive !== true;
		if (negZero) {
			if (options.dryRun === true) {
				state.offset = state.offset + (3);
				return;
			}
			byteView[state.offset] = 0xf9; // fp16
			byteView[state.offset + 1] = 0x80;
			byteView[state.offset + 2] = 0x00;
			state.offset = state.offset + (3);
			return;
		}
		const integerValue = Math.floor(value); // TODO: maybe find alternative check
		const encodedValue = ( positive ? integerValue : ~integerValue ) >>> 0;
		if (value === integerValue && encodedValue < POW_2_32) {
			encodeInteger(positive, encodedValue, byteView, state, options);
		} else {
			// floating point or bigger than 32-bit integer
			smallBufferFloat32[0] = value;
			const uintValue = smallBufferUint32[0];
			const unsigned = uintValue & 0x7fffffff;
			if (smallBufferFloat32[0] === value) {
				// easily translated
				if (unsigned > 0x38800000 && unsigned < 0x47000000 && (unsigned & 0x00001fff) === 0) {
					if (options.dryRun === true) {
						state.offset = state.offset + (3);
						return;
					}
					byteView[state.offset] = 0xf9; // fp16
					const expBiasAdjust = (127 - 15) << 10;
					const signBits = (uintValue & 0x80000000) >>> 16;
					const expoBits = ((unsigned & 0x7f800000) >>> 13 ) - expBiasAdjust;
					const mantissaBits = (unsigned & 0x007fffff) >>> 13;
					const float16Bits = signBits | expoBits | mantissaBits;
					byteView[state.offset + 1] = float16Bits >>> 8;
					byteView[state.offset + 2] = float16Bits & 0xff;
					state.offset = state.offset + (3);
					return;
				}
				// depends on dropping bits from the mantissa
				if (unsigned >= 0x33800000 && unsigned <= 0x38800000) {
					// 0x38800000, -14 allows 10 bits
					// 0x38000000, -15 allows 9 bits
					// 0x37800000, -16 allows 8 bits
					// 0x37000000, -17 allows 7 bits
					// 0x36800000, -18 allows 6 bits
					// 0x36000000, -19 allows 5 bits
					// 0x35800000, -20 allows 4 bits
					// 0x35000000, -21 allows 3 bits
					// 0x34800000, -22 allows 2 bits
					// 0x34000000, -23 allows 1 bits
					// 0x33800000, -24 allows 0 bits

					const mantissaBitsAllowed = ( (unsigned & 0x7f800000) >> 23 ) - ( 127 - 24 );
					const mantissaAllowedMask = (0xff800000 >> mantissaBitsAllowed) >>> 0;
					if ((unsigned & ~mantissaAllowedMask) === 0) {
						if (options.dryRun === true) {
							state.offset = state.offset + (3);
							return;
						}
						byteView[state.offset] = 0xf9; // fp16
						const mantissaBits = (unsigned & mantissaAllowedMask & 0x007fffff) >>> (23 - mantissaBitsAllowed);
						const highBit = 1 << mantissaBitsAllowed;
						const signBits = (uintValue & 0x80000000) >>> 16;
						const float16Bits = signBits | highBit | mantissaBits;
						byteView[state.offset + 1] = float16Bits >>> 8;
						byteView[state.offset + 2] = float16Bits & 0xff;
						state.offset = state.offset + (3);
						return;
					}
				}
				if (options.dryRun === true) {
					state.offset = state.offset + (5);
					return;
				}
				byteView[state.offset] = 0xfa; // fp32
				//byteView.set(smallBuffer4Bytes, state.offset + 1); // LE
				byteView[state.offset + 1] = smallBuffer4Bytes[3];
				byteView[state.offset + 2] = smallBuffer4Bytes[2];
				byteView[state.offset + 3] = smallBuffer4Bytes[1];
				byteView[state.offset + 4] = smallBuffer4Bytes[0];
				state.offset = state.offset + (5);
				return;
			}
			encodeDouble(value, byteView, state, options);
		}
	}

	/**
	 *
	 * @param {string} value
	 * @param {Uint8Array} byteView
	 * @param {Object} state
	 * @param {Object} options
	 */
	function encodeString(value, byteView, state, options) {
		if (options.noExplicitConversion !== true && value.length >= options.minExplicitConvSize) {
			if (value.length >= 2) {
				const base16StringCheck = detectHexString(value);
				if (base16StringCheck !== 0) {
					// uppercase
					if (base16StringCheck === 1) {
						encodeTag(23, byteView, state, options);
						encodePrefix(64, getHexStringByteLength(value), byteView, state, options);
						encodeHexStringAsBytes(value, byteView, state, options);
						return;
					}
					// lowercase
					else if (base16StringCheck === -1 && options.explicitConvertLowerCaseHex === true) {
						encodeTag(126, byteView, state, options);
						encodePrefix(64, getHexStringByteLength(value), byteView, state, options);
						encodeHexStringAsBytes(value, byteView, state, options);
						return;
					}
				}
				if (value.length >= 4) {
					const base64StringCheck = detectBase64String(value);
					if (base64StringCheck !== 0) {
						// base64
						if (base64StringCheck === 1)
							encodeTag(21, byteView, state, options);
						// base64url
						else
							encodeTag(22, byteView, state, options);

						encodePrefix(64, getBase64StringByteLength(value), byteView, state, options);
						encodeBase64StringAsBytes(value, byteView, state, options);
						return;
					}
				}
			}
		}
		encodeStringRaw(value, byteView, state, options);
	}


	/**
	 *
	 * @param {string} value
	 * @param {Uint8Array} byteView
	 * @param {Object} state
	 * @param {Object} options
	 */
	function encodeStringRaw(value, byteView, state, options) {
		encodePrefix(96, getByteLengthOfUtf8String(value), byteView, state, options);
		encodeUtf8StringAsBytes(value, byteView, state, options);
	}

	/**
	 *
	 * @param {Int8Array|Uint8ClampedArray|Int16Array|Uint16Array|Int32Array|Uint32Array|Float32Array|Float64Array|DataView|Buffer} value
	 * @param byteView
	 * @param state
	 * @param options
	 */
	function encodeBufferView(value, byteView, state, options) {
		if (options.doNotTagTypedArrays !== true) {
			const proto = value.constructor;
			switch (proto) {
				case Int8Array: {
					encodeTag(129, byteView, state, options);
					break;
				}
				case Uint8ClampedArray: {
					encodeTag(131, byteView, state, options);
					break;
				}
				case Int16Array: {
					encodeTag(132, byteView, state, options);
					break;
				}
				case Uint16Array: {
					encodeTag(133, byteView, state, options);
					break;
				}
				case Int32Array: {
					encodeTag(134, byteView, state, options);
					break;
				}
				case Uint32Array: {
					encodeTag(135, byteView, state, options);
					break;
				}
				case Float32Array: {
					encodeTag(136, byteView, state, options);
					break;
				}
				case Float64Array: {
					encodeTag(137, byteView, state, options);
					break;
				}
				case DataView: {
					encodeTag(138, byteView, state, options);
					break;
				}
				case Buffer: {
					encodeTag(139, byteView, state, options);
					break;
				}
				default: {
					if (options.doNotThrow !== true)
						throw new Error("Unknown ArrayBuffer View prototype " + proto.name);
				}
			}
		}

		//noinspection JSCheckFunctionSignatures
		encodePrefix(64, value.byteLength, byteView, state, options);
		//noinspection JSCheckFunctionSignatures
		encodeBuffer(value.buffer, byteView, state, options, value.byteOffset, value.byteLength);
	}

	/**
	 *
	 * @param {number} baseValue
	 * @param {number} value
	 * @param {Uint8Array} byteView
	 * @param {Object} state
	 * @param {Object} options
	 */
	function encodePrefix(baseValue, value, byteView, state, options) {
		if (value < 0) {
			if (options.doNotThrow === true)
				value = 0;
			else
				throw new Error("Attempting to encode length less than zero");
		}
		if (value < 24) {
			if (options.dryRun === true) {
				state.offset = state.offset + (1);
				return;
			}
			byteView[state.offset++] = baseValue + value;
		} else if (value < 256) {
			if (options.dryRun === true) {
				state.offset = state.offset + (2);
				return;
			}
			byteView[state.offset++] = baseValue + 24;
			byteView[state.offset++] = value;
		} else if (value < 65536) {
			if (options.dryRun === true) {
				state.offset = state.offset + (3);
				return;
			}
			byteView[state.offset++] = baseValue + 25;
			byteView[state.offset++] = value >>> 8;
			byteView[state.offset++] = value;
		} else if (value < POW_2_32) {
			if (options.dryRun === true) {
				state.offset = state.offset + (5);
				return;
			}
			byteView[state.offset++] = baseValue + 27;
			byteView[state.offset++] = value >>> 24;
			byteView[state.offset++] = value >>> 16;
			byteView[state.offset++] = value >>> 8;
			byteView[state.offset++] = value;
		} else {
			if (options.dryRun === true) {
				state.offset = state.offset + (9);
				return;
			}
			byteView[state.offset++] = baseValue + 28;
			const highValue = ( value / POW_2_32 ) >>> 0;
			byteView[state.offset++] = highValue >>> 24;
			byteView[state.offset++] = highValue >>> 16;
			byteView[state.offset++] = highValue >>> 8;
			byteView[state.offset++] = highValue;
			const lowValue = value % POW_2_32;
			byteView[state.offset++] = lowValue >>> 24;
			byteView[state.offset++] = lowValue >>> 16;
			byteView[state.offset++] = lowValue >>> 8;
			byteView[state.offset++] = lowValue;
		}
	}

	/**
	 *
	 * @param {number} value
	 * @param {Uint8Array} byteView
	 * @param {Object} state
	 * @param {Object} options
	 */
	function encodeTag(value, byteView, state, options) {
		encodePrefix(192, value, byteView, state, options);
	}

	/**
	 *
	 * @param {number} value
	 * @param {Uint8Array} byteView
	 * @param {Object} state
	 * @param {Object} options
	 */
	function encodeSimpleValue(value, byteView, state, options) {
		encodePrefix(224, value, byteView, state, options);
	}

	/**
	 *
	 * @param {ArrayBuffer} value
	 * @param {Uint8Array} byteView
	 * @param {Object} state
	 * @param {Object} options
	 * @param {number} valueOffset
	 * @param {number} valueLength
	 */
	function encodeBuffer(value, byteView, state, options, valueOffset, valueLength) {
		if (options.dryRun) {
			state.offset = state.offset + (valueLength);
			return;
		}
		const source = new Uint8Array(value, valueOffset, valueLength);
		const destination = new Uint8Array(byteView.buffer, byteView.byteOffset + state.offset, valueLength);
		destination.set(source);
	}

	/**
	 *
	 * @param {Array} value
	 * @param {Uint8Array} byteView
	 * @param {Object} state
	 * @param {Object} options
	 */
	function encodeArray(value, byteView, state, options) {
		const memberCount = value.length;
		encodePrefix(128, memberCount, byteView, state, options);
		let member = undefined;
		for (let i = 0; i < memberCount; ++i) {
			member = value[i];
			encodeElement(member, byteView, state, options);
		}
	}

	/**
	 *
	 * @param {Set} set
	 * @param {Uint8Array} byteView
	 * @param {Object} state
	 * @param {Object} options
	 */
	function encodeSet(set, byteView, state, options) {
		const memberCount = set.size;
		encodeTag(128, byteView, state, options);
		encodePrefix(128, memberCount, byteView, state, options);
		for (let item of set) {
			encodeElement(item, byteView, state, options);
		}
	}

	/**
	 *
	 * @param {Uint8Array} byteView
	 * @param {Object} state
	 * @param {Object} options
	 */
	function encodeWeakSet(byteView, state, options) {
		encodeTag(144, byteView, state, options);
		encodePrefix(160, 0, byteView, state, options);

	}

	/**
	 *
	 * @param {Map} map
	 * @param {Uint8Array} byteView
	 * @param {Object} state
	 * @param {Object} options
	 */
	function encodeMap(map, byteView, state, options) {
		const memberCount = map.size;
		encodeTag(127, byteView, state, options);
		encodePrefix(160, memberCount, byteView, state, options);
		for (let [key, value] of map) {
			encodeElement(key, byteView, state, options);
			encodeElement(value, byteView, state, options);
		}
	}

	/**
	 *
	 * @param {Uint8Array} byteView
	 * @param {Object} state
	 * @param {Object} options
	 */
	function encodeWeakMap(byteView, state, options) {
		encodeTag(143, byteView, state, options);
		encodePrefix(160, 0, byteView, state, options);

	}

	/**
	 * helper function to test if a char code is within the decimal numeric range
	 * @param {number} charCode
	 * @returns {boolean}
	 */
	function isNumericChar(charCode) {
		return charCode >= 48 && charCode <= 57;
	}

	/**
	 * helper function to test of a string just is a sequence of integers
	 * exclude sequences that start with 0 that are not just 0
	 * @param {string} string
	 * @returns {boolean}
	 */

	function isPositiveIntegerString(string) {
		const firstCharCode = string.codePointAt(0);
		if ( firstCharCode === 0x30 )
			return string.length === 1;
		let isCharNumeric = isNumericChar(firstCharCode);
		if (string.length > 1 && isCharNumeric) {
			let i = 1;
			do {
				isCharNumeric = isNumericChar(string.codePointAt(i));
			} while (isCharNumeric && i < string.length);
		}
		return isCharNumeric;
	}

	/**
	 *
	 * @param {string} string
	 * @param {Uint8Array} byteView
	 * @param {Object} state
	 * @param {Object} options
	 */
	function encodeStringMaybeInteger(string, byteView, state, options) {

		const isPosInt = isPositiveIntegerString(string);
		if (isPosInt) {
			encodeInteger(true, parseInt(string, 10), byteView, state, options);
		}
		else {
			encodeString(string, byteView, state, options);
		}
	}

	/**
	 *
	 * @param {Object} object
	 * @param {Uint8Array} byteView
	 * @param {Object} state
	 * @param {Object} options
	 */
	function encodeObject(object, byteView, state, options) {
		const keys = Object.keys(object);
		const memberCount = keys.length;
		encodePrefix(160, memberCount, byteView, state, options);
		let key = undefined;
		let value = undefined;
		for (let i = 0; i < memberCount; ++i) {
			key = keys[i];
			value = object[key];
			encodeStringMaybeInteger(key, byteView, state, options);
			encodeElement(value, byteView, state, options);
		}
	}

	/**
	 *
	 * @param {*} value
	 * @param {Uint8Array} byteView
	 * @param {Object} state
	 * @param {Object} options
	 */
	function encodeElement(value, byteView, state, options) {
		switch (value) {
			case false: {
				encodeSimpleValue(20, byteView, state, options);
				break;
			}
			case true: {
				encodeSimpleValue(21, byteView, state, options);
				break;
			}
			case null: {
				encodeSimpleValue(22, byteView, state, options);
				break;
			}
			case undefined: {
				encodeSimpleValue(23, byteView, state, options);
				break;
			}
			default:
				switch (typeof value) {
					case 'number': {
						encodeNumber(value, byteView, state, options);
						break;
					}
					case 'string': {
						encodeString(value, byteView, state, options);
						break;
					}
					case 'symbol': {
						const key = Symbol.keyFor(value);
						if (key !== undefined) {
							encodeTag(141, byteView, state, options);
							encodeStringRaw(`Symbol.for(${key})`, byteView, state, options);
							break;
						} else {
							switch (value) {
								case Symbol.iterator: {
									encodeSimpleValue(32, byteView, state, options);
									break;
								}
								case Symbol.match: {
									encodeSimpleValue(33, byteView, state, options);
									break;
								}
								case Symbol.replace: {
									encodeSimpleValue(34, byteView, state, options);
									break;
								}
								case Symbol.search: {
									encodeSimpleValue(35, byteView, state, options);
									break;
								}
								case Symbol.split: {
									encodeSimpleValue(36, byteView, state, options);
									break;
								}
								case Symbol.hasInstance: {
									encodeSimpleValue(37, byteView, state, options);
									break;
								}
								case Symbol.isConcatSpreadable: {
									encodeSimpleValue(38, byteView, state, options);
									break;
								}
								case Symbol.unscopables: {
									encodeSimpleValue(39, byteView, state, options);
									break;
								}
								case Symbol.species: {
									encodeSimpleValue(40, byteView, state, options);
									break;
								}
								case Symbol.toPrimitive: {
									encodeSimpleValue(41, byteView, state, options);
									break;
								}
								case Symbol.toStringTag: {
									encodeSimpleValue(42, byteView, state, options);
									break;
								}
								default: {
									encodeTag(142, byteView, state, options);
									// string is formatted "Symbol(name)"
									encodeStringRaw(value.toString(), byteView, state, options);
									break;
								}
							}
							break;
						}
					}
					case 'object': {
						if (value instanceof Date) {
							if (options.encodeDatesAsStrings !== true) {
								encodeTag(1, byteView, state, options);
								encodeDouble(value.valueOf() / 1000, byteView, state, options);
							} else {
								encodeTag(0, byteView, state, options);
								encodeStringRaw(value.toISOString(), byteView, state, options);
							}
							break;
						}
						if (value instanceof RegExp) {
							encodeTag(35, byteView, state, options);
							// this can be B64 encoded. what.
							encodeString(`/${value.source}/${value.flags}`, byteView, state, options);
							break;
						}
						if (value instanceof Number) {
							if (options.doNotTagBoxedValues !== true)
								encodeTag(270, byteView, state, options);
							encodeNumber(value.valueOf(), byteView, state, options);
							break;
						}
						if (value instanceof String) {
							if (options.doNotTagBoxedValues !== true)
								encodeTag(270, byteView, state, options);
							encodeString(value.valueOf(), byteView, state, options);
							break;
						}
						if (value instanceof Boolean) {
							if (options.doNotTagBoxedValues !== true)
								encodeTag(270, byteView, state, options);
							byteView[state.offset++] = value.valueOf() === true ? 245 : 244;
							break;
						}
						if (value instanceof ArrayBuffer) {
							encodeTag(130, byteView, state, options);
							encodePrefix(64, value.byteLength, byteView, state, options);
							encodeBuffer(value, byteView, state, options, 0, value.byteLength);
							break;
						}
						if (value instanceof Uint8Array) {
							encodePrefix(64, value.byteLength, byteView, state, options);
							encodeBuffer(value.buffer, byteView, state, options, value.byteOffset, value.byteLength);
							break;
						}
						if (ArrayBuffer.isView(value)) {
							encodeBufferView(value, byteView, state, options);
							break;
						}
						if (Array.isArray(value)) {
							encodeArray(value, byteView, state, options);
							break;
						}
						if (value instanceof Map) {
							encodeMap(value, byteView, state, options);
							break;
						}
						if (value instanceof Set) {
							encodeSet(value, byteView, state, options);
							break;
						}
						if (value instanceof WeakMap) {
							encodeWeakMap(byteView, state, options);
							break;
						}
						if (value instanceof WeakSet) {
							encodeWeakSet( byteView, state, options);
							break;
						}
						encodeObject(value, byteView, state, options);
						break;
					}
					default: {
						throw new Error('Unknown element type ' + (typeof value));
					}
				}
		}
	}

	/**
	 *
	 * @param {*} value
	 * @param {Object} [options]
	 * @returns {number|ArrayBuffer}
	 */
	function encode(value, options) {
		if (arguments.length < 2 || options === null || typeof options !== 'object')
			options = Object.create(null);
		const state = {offset: 0, length: 0, end: 0, next: undefined};

		let buffer = null;
		let byteView = null;

		if ( isNaN(options.minExplicitConvSize) )
			options.minExplicitConvSize = 2;

		if (options.dryRun !== true) {
			const optionsDryRun = Object.setPrototypeOf({dryRun: true}, options);
			const length = encode(value, optionsDryRun);
			state.length = length;
			state.offset = 0;
			state.end = length;
			byteView = new Uint8Array(state.length);
			buffer = byteView.buffer;
		}

		if (options.selfDescribing === true)
			encodeTag(55799, byteView, state, options);

		encodeElement(value, byteView, state, options);

		if (options.dryRun === true)
			return state.offset;
		return buffer;
	}

	/**
	 *
	 * @param {Uint8Array} byteView
	 * @param {number} offset
	 * @returns {number}
	 */
	function readUint16(byteView, offset) {
		return (byteView[offset] << 8) | byteView[offset + 1];
	}

	/**
	 *
	 * @param {Uint8Array} byteView
	 * @param {number} offset
	 * @returns {number}
	 */
	function readUint32(byteView, offset) {
		return (
				(byteView[offset] << 24) |
				(byteView[offset + 1] << 16) |
				(byteView[offset + 2] << 8) |
				byteView[offset + 3]
			) >>> 0;
	}

	/**
	 *
	 * @param {Uint8Array} byteView
	 * @param {number} offset
	 * @returns {number}
	 */
	function readUint64(byteView, offset) {
		return readUint32(byteView, offset) *
			POW_2_32 + readUint32(byteView, offset + 4);
	}

	/**
	 *
	 * @param {number} value
	 * @returns {number}
	 */
	function decodeFloat16(value) {
		const expoBits = value & 0x7C00,
			fraction = value & 0x03FF,
			sign = ( value << 16 >> 31 ) | 1;
		return (expoBits === 0
				? sign * fraction * POW_2_24
				: expoBits !== 0x7C00
			        ? sign * (1 << ( (expoBits >>> 10) - 25 )) * (fraction + 0x0400)
			        : fraction !== 0
					  ? NaN
					  : sign * Infinity
		);
    }

	/**
	 *
	 * @param {Uint8Array} byteView
	 * @param {Object} state
	 * @param {number} elementCount
	 * @param {Object} options
	 * @returns {Array|Set}
	 */
    function parseFixedLengthArray(byteView, state, elementCount, options) {
        const array = [];

        for (let i = 0; i < elementCount; ++i)
            array.push(decodeElement(byteView, state, options));

        return array;
    }

	/**
	 *
	 * @param {Uint8Array} byteView
	 * @param {Object} state
	 * @param {number} elementCount
	 * @param {Object} options
	 * @returns {Array|Set}
	 */
    function parseFixedLengthSet(byteView, state, elementCount, options) {
        const set = new Set();
        state.next = undefined;

        for (let i = 0; i < elementCount; ++i)
            set.add(decodeElement(byteView, state, options));

        return set;
    }

	/**
	 *
	 * @param {Uint8Array} byteView
	 * @param {Object} state
	 * @param {number} elementCount
	 * @param {Object} options
	 * @returns {object|Map}
	 */
    function parseFixedLengthObject(byteView, state, elementCount, options) {
        const object = Object.create(null);
		let nextKey = undefined;
		let nextValue = undefined;

        for (let i = 0; i < elementCount; ++i) {
            nextKey = decodeElement(byteView, state, options);
            if (nextKey === breakIndicator) {
                if (options.doNotThrow !== true)
                    throw new Error("Break indicator encountered when decoding key fixed-length map element.");
                --i;
                continue;
            }
            if (nextKey instanceof NonCodingIndicator) continue;


            nextValue = decodeElement(byteView, state, options);
            while (nextValue !== breakIndicator) {
                if (!(nextValue instanceof NonCodingIndicator)) {
                    object[nextKey] = nextValue;
                    break;
                }
                nextValue = decodeElement(byteView, state, options);
            }
            if (nextValue === breakIndicator) {
                if (options.doNotThrow !== true)
                    throw new Error("Break indicator encountered when decoding value of map element.");
            }

        }
        return object;
    }

	/**
	 *
	 * @param {Uint8Array} byteView
	 * @param {Object} state
	 * @param {number} elementCount
	 * @param {Object} options
	 * @returns {object|Map}
	 */
    function parseFixedLengthMap(byteView, state, elementCount, options) {
        const map = new Map;

        let nextKey = undefined;
        let nextValue = undefined;

        for (let i = 0; i < elementCount; ++i) {
            nextKey = decodeElement(byteView, state, options);
            if (nextKey === breakIndicator) {
                if (options.doNotThrow !== true)
                    throw new Error("Break indicator encountered when decoding key fixed-length map element.");
                --i;
                continue;
            }
            if (nextKey instanceof NonCodingIndicator) continue;


            nextValue = decodeElement(byteView, state, options);
            while (nextValue !== breakIndicator) {
                if (!(nextValue instanceof NonCodingIndicator)) {
                    map.set(nextKey, nextValue);
                    break;
                }
                nextValue = decodeElement(byteView, state, options);
            }
            if (nextValue === breakIndicator) {
                if (options.doNotThrow !== true)
                    throw new Error("Break indicator encountered when decoding value of map element.");
            }

        }
        return map;
    }

	/**
	 * https://www.iana.org/assignments/cbor-tags/cbor-tags.xhtml
	 * @param {number} tag
	 * @param {Uint8Array} byteView
	 * @param {Object} state
	 * @param {Object} options
	 * @returns {*}
	 */
	function parseTag(tag, byteView, state, options) {

		function textDateTime() {
			const dateString = decodeElement(byteView, state, options);
			if (typeof dateString != 'string')
				throw new Error("Date tagged as encoded as string, but is " + (typeof dateString));
			return new Date(dateString);
		}

		function epochDateTime() {
			const dateValue = decodeElement(byteView, state, options);
			if (typeof dateValue != 'number')
				throw new Error("Date tagged as encoded as number, but is " + (typeof dateValue));
			return new Date(dateValue * 1000);
		}

		function arbitraryPrecisionNotImplemented() {
			if (options.throwOnUnsupportedTag === true)
				throw new Error("Arbitrary precision numbers not yet implemented");
			return decodeElement(byteView, state, options);
		}

		function explicitBase64() {
			const byteArray = decodeElement(byteView, state, options);
			if (!(byteArray instanceof Uint8Array )) {
				if (options.doNotThrow !== true)
					throw new Error("Explicit Base64 string conversion tag encoded value is not given as byte array.");
				return byteArray;
			}
			return decodeBytesAsBase64String(byteArray, {
				offset: 0,
				base64Url: false
			}, byteArray.byteLength, options);
		}

		function explicitBase64Url() {

			const byteArray = decodeElement(byteView, state, options);
			if (!(byteArray instanceof Uint8Array )) {
				if (options.doNotThrow !== true)
					throw new Error("Explicit Base64Url string conversion tag encoded value is not given as byte array.");
				return byteArray;
			}
			return decodeBytesAsBase64String(byteArray.byteLength,
				byteArray, {
					offset: 0,
					base64Url: true
				}, options);

		}

		function explicitBase16() {
			const byteArray = decodeElement(byteView, state, options);
			if (!(byteArray instanceof Uint8Array )) {
				if (options.doNotThrow !== true)
					throw new Error("Explicit Base16 (Upper Case) string conversion tag encoded value is not given as byte array.");
				return byteArray;
			}
			return decodeBytesAsHexString(byteArray.byteLength,
				byteArray, {
					offset: 0,
					hexLowerCase: false
				}, options);
		}

		function embeddedCbor() {
			const byteArray = decodeElement(byteView, state, options);
			if (!(byteArray instanceof Uint8Array )) {
				if (options.doNotThrow !== true)
					throw new Error("Embedded CBOR element conversion tag encoded value is not given as byte array.");
				return byteArray;
			}
			return decode(byteArray, options);
		}

		function regExp() {
			const regexString = decodeElement(byteView, state, options);
			if (typeof regexString != 'string') {
				if (options.doNotThrow !== true)
					throw new Error("Tagged regular expression element should be string, is " + (typeof regexString));
				return regexString;
			}
			const regexParts = regExpForRegExps.exec(regexString);
			if (regexParts === null) {
				if (options.doNotThrow !== true)
					throw new Error("Tagged regular expression is not valid.");
				return regexString;
			}
			return new RegExp(regexParts[1], regexParts[2]);
		}

		function selfDescription() {
			// full 3 bytes: tag 0xD9, data 0xD9, 0xF7
			if (state.offset !== 1) {
				if (options.doNotThrow !== true)
					throw new Error("Encountered CBOR self-description tag sequence, but not at the start of the stream.");
			}
			return selfDescribingIndicator;
		}

		function base16LC() {
			const byteArray = decodeElement(byteView, state, options);
			if (!(byteArray instanceof Uint8Array )) {
				if (options.doNotThrow !== true)
					throw new Error("Explicit Base 16 (Lower Case) string conversion tag encoded value is not given as byte array.");
				return byteArray;
			}
			return decodeBytesAsHexString(byteArray, {
				offset: 0,
				hexLowerCase: true
			}, byteArray.byteLength, options);
		}

		function map() {

			state.next = Map;
			const map = decodeElement(byteView, state, options);
			if (!(map instanceof Map )) {
				if (options.doNotThrow !== true)
					throw new Error("Map tag encoded value is not given as a map.");
				state.next = undefined;
			}
			return map;
		}

		function set() {

			state.next = Set;
			const set = decodeElement(byteView, state, options);
			if (!(set instanceof Set )) {
				if (options.doNotThrow !== true)
					throw new Error("Set tag encoded value is not given as an array.");
				state.next = undefined;
			}
			return set;
		}

		function arrayViewType(type) {
			const byteArray = decodeElement(byteView, state, options);
			if (!(byteArray instanceof Uint8Array )) {
				if (options.doNotThrow !== true)
					throw new Error(`${type.name} tag encoded value is not given as byte array.`);
				return byteArray;
			}
			return new type(byteArray.buffer, byteArray.byteOffset, byteArray.byteLength);
		}

		function arrayBuffer() {
			const byteArray = decodeElement(byteView, state, options);
			if (!(byteArray instanceof Uint8Array )) {
				if (options.doNotThrow !== true)
					throw new Error("Uint8Array tag encoded value is not given as byte array.");
				return byteArray;
			}
			const newByteArray = new Uint8Array(byteArray.byteLength);
			newByteArray.set(byteArray, 0);
			return newByteArray.buffer;
		}

		function buffer() {
			if (Buffer === undefined)
				return nonCodingIndicator;

			const byteArray = decodeElement(byteView, state, options);
			if (!(byteArray instanceof Uint8Array )) {
				if (options.doNotThrow !== true)
					throw new Error("Buffer tag encoded value is not given as byte array.");
				return byteArray;
			}
			return Buffer.from(byteArray.buffer, byteArray.byteOffset, byteArray.byteLength);
		}

		function boxed() {
			const value = decodeElement(byteView, state, options);
			switch (typeof value) {
				case 'number' : //noinspection JSPrimitiveTypeWrapperUsage
					return new Number(value);
				case 'boolean' : //noinspection JSPrimitiveTypeWrapperUsage
					return new Boolean(value);
				case 'string' : //noinspection JSPrimitiveTypeWrapperUsage
					return new String(value);
				default: {
					if (options.doNotThrow !== true)
						throw new Error("Boxed type tag precedes unboxable typed element.");
					return value;
				}
			}
		}

		function sharedSymbol() {

			const value = decodeElement(byteView, state, options);
			if (typeof value !== 'string') {
				if (options.doNotThrow !== true)
					throw new Error("Shared symbol string tag precedes non-string element.");
				return value;
			}
			const regExpResult = regExpForSharedSymbols.exec(value);
			if (regExpResult === null) {
				if (options.doNotThrow !== true)
					throw new Error("Shared symbol string is not in the expected format.");
				return value;
			}
			return Symbol.for(regExpResult[1]);
		}

		function uniqueSymbol() {

			const value = decodeElement(byteView, state, options);
			if (typeof value !== 'string') {
				if (options.doNotThrow !== true)
					throw new Error("Unique symbol string tag precedes non-string element.");
				return value;
			}
			const regExpResult = regExpForUniqueSymbols.exec(value);
			if (regExpResult === null) {
				if (options.doNotThrow !== true)
					throw new Error("Unique symbol string is not in the expected format.");
				return value;
			}
			return Symbol(regExpResult[1]);
		}

		function weakMap() {

			const object = decodeElement(byteView, state, options);
			if (!(object instanceof Object )) {
				if (options.doNotThrow !== true)
					throw new Error("WeakMap tag encoded value is not given as an object.");
			}
			if (Object_isEmpty(object) !== true) {
				if (options.doNotThrow !== true)
					throw new Error("WeakMap tag encoded object must be empty.");
				return object;
			}
			return new WeakMap();
		}

		function weakSet() {

			const array = decodeElement(byteView, state, options);
			if (!(Array.isArray(array))) {
				if (options.doNotThrow !== true)
					throw new Error("WeakSet tag encoded value is not given as an array.");
			}
			if (array.length !== 0) {
				if (options.doNotThrow !== true)
					throw new Error("WeakSet tag encoded array must be empty.");
				return array;
			}
			return new WeakSet();
		}

		function unknown() {

			if ('unknownTagParser' in options) {
				const result = options.unknownTagParser(tag, byteView, state, options);
				if (options.doNotThrow !== true && options.throwOnUnsupportedTag === true && result instanceof ErrorIndicator)
					throw new Error('Encountered unknown and unhandled tag ' + tag);
				return result;

			}
			if (options.doNotThrow !== true && options.throwOnUnsupportedTag === true)
				throw new Error("Tag not yet implemented or unsupported.");
			return errorIndicator;
		}

		switch (tag) {
			// tag 0, Text based date and time
			case 0: {
				return textDateTime();
			}
			// tag 1, Epoch based date and time
			case 1: {
				return epochDateTime();
			}
			// tag 2, Positive big number
			// tag 3, Negative big number
			// tag 4, Decimal fraction
			// tag 5, big floating point
			case 2:
			case 3:
			case 4: {
				return arbitraryPrecisionNotImplemented();
			}

			// tags 6 to 20, unassigned

			// unofficial:
			// unique back-references:
			// tag 6: binary back-reference
			// tag 7: string back-reference
			// tag 8: array back-reference
			// tag 9: map back-reference

			// duplicating back-references:
			// tag 10: binary back-reference
			// tag 11: string back-reference
			// tag 12: array back-reference
			// tag 13: map back-reference

			// small duplicating back-references:
			// tag 14: 64-bit element back-reference
			// tag 15: 32-bit element back-reference
			// tag 16: 16-bit element back-reference

			// tags 21 to 23, explicit conversions: base64url, base64, base16 (upper-case)
			case 21: {
				return explicitBase64()
			}
			case 22: {
				return explicitBase64Url();
			}
			case 23: {
				return explicitBase16();
			}

			// tag 24: embedded CBOR element
			case 24: {
				return embeddedCbor();
			}
			// tags 25 to 31, unassigned
			// tag 32, URI text
			case 32 : {
				return nonCodingIndicator;
			}
			// tag 33, base64url text
			case 33 : {
				return nonCodingIndicator;
			}
			// tag 34, base64 text
			case 34 : {
				return nonCodingIndicator;
			}
			// tag 35, regex
			case 35 : {
				return regExp();
			}
			// tag 36, MIME message
			case 36 : {
				return nonCodingIndicator;
			}
			// tags 37 to 55798, unassigned
			// tags 55800 and up, unassigned

			// unofficial:
			// 126: explicit conversion of binary string to base16 (lower case) string
			case 126: {
				return base16LC();
			}
			// 127: following map is a 'Map'
			case 127: {
				return map();
			}
			// 128: following array is a 'Set'
			case 128: {
				return set();
			}
			// 129: following binary string is an 'Int8Array'
			case 129: {
				return arrayViewType(Int8Array);
			}
			// 130: following binary string is an 'ArrayBuffer'
			case 130: {
				return arrayBuffer();
			}
			// 131: following binary string is an 'Uint8ClampedArray'
			case 131: {
				return arrayViewType(Uint8ClampedArray);
			}
			// 132: following binary string or array is an 'Int16Array'
			case 132: {
				return arrayViewType(Int16Array);
			}
			// 133: following binary string or array is an 'Uint16Array'
			case 133: {
				return arrayViewType(Uint16Array);
			}
			// 134: following binary string or array is an 'Int32Array'
			case 134: {
				return arrayViewType(Int32Array);
			}
			// 135: following binary string or array is an 'Uint32Array'
			case 135: {
				return arrayViewType(Uint32Array);
			}
			// 136: following binary string or array is a 'Float32Array'
			case 136: {
				return arrayViewType(Float32Array);
			}
			// 137: following binary string or array is a 'Float64Array'
			case 137: {
				return arrayViewType(Float64Array);
			}
			// 138: following binary string or array is a 'DataView'
			case 138: {
				return arrayViewType(DataView);
			}
			// 139: following string, binary string or array is a 'Buffer'
			case 139: {
				return buffer();

			}
			// 141: following string is a shared named symbol
			case 141: {
				return sharedSymbol();
			}
			// 142: following string is a unique unshared symbol
			case 142: {
				return uniqueSymbol();
			}
			// empty WeakMap object
			case 143: {
				return weakMap();
			}
			// empty WeakSet object
			case 144: {
				return weakSet();
			}
			// 270: following element is a boxed version of a simple type (e.g. Number, Boolean, String)
			case 270: {
				return boxed();
			}
			// tag 55799, self-describing CBOR
			case 55799: {
				return selfDescription();
			}

			default: {
				return unknown();
			}
		}
	}

	/**
	 * https://www.iana.org/assignments/cbor-simple-values/cbor-simple-values.xhtml
	 * @param {number} value
	 * @param {Uint8Array} byteView
	 * @param {Object} state
	 * @param {Object} options
	 */
	function parseSimpleValue(value, byteView, state, options) {
		switch (value) {
			case 20:
				return false;
			case 21:
				return true;
			case 22:
				return null;
			case 23:
				return undefined;
			case 32:
				return Symbol.iterator;
			case 33:
				return Symbol.match;
			case 34:
				return Symbol.replace;
			case 35:
				return Symbol.search;
			case 36:
				return Symbol.split;
			case 37:
				return Symbol.hasInstance;
			case 38:
				return Symbol.isConcatSpreadable;
			case 39:
				return Symbol.unscopables;
			case 40:
				return Symbol.species;
			case 41:
				return Symbol.toPrimitive;
			case 42:
				return Symbol.toStringTag;
			default: {
				if ('unknownSimpleValueParser' in options) {
					const result = options.unknownSimpleValueParser(value, byteView, state, options);
					if (options.doNotThrow !== true && options.throwOnUnsupportedSimpleValue === true && result instanceof ErrorIndicator)
						throw new Error('Encountered unknown and unhandled simple value ' + value);
					if (result === undefined)
						return new UnknownSimpleValue(value);
					return result;
				}
				if (options.doNotThrow !== true && options.throwOnUnsupportedSimpleValue === true)
					throw new Error('Encountered unknown simple value ' + value);
				return nonCodingIndicator;
			}
		}
	}

	/**
	 *
	 * @param {Uint8Array} byteView
	 * @param {Object} state
	 * @param {Object} options
	 * @returns {*}
	 */
	function decodeElement(byteView, state, options) {
		let value;

		let i;
		let byteLength;
		let values;
		let nextKey;
		let nextValue;
		let valueView;
		let elementCount;
		let next;
		let offset;
		let current;
		let currentLength;


		if (state.offset >= state.end) {
			if (options.doNotThrow !== true)
				throw new Error("Encoded data does not terminate properly.");
			return errorIndicator;
		}

		let byte = byteView[state.offset];
		switch (byte) {
			default: {
				if (!options.doNotThrow)
					throw new Error(`Invalid or unimplemented encoding prefix ${byte}.`);
				return errorIndicator;
			}

			// positive integers
			case  0:
			case  1:
			case  2:
			case  3:
			case  4:
			case  5:
			case  6:
			case  7:
			case  8:
			case  9:
			case 10:
			case 11:
			case 12:
			case 13:
			case 14:
			case 15:
			case 16:
			case 17:
			case 18:
			case 19:
			case 20:
			case 21:
			case 22:
			case 23: {
				if (options.dryRun !== true)
					value = byte;
				state.offset = state.offset + (1);
				break;
			}
			case 24: {
				if (options.dryRun !== true)
					value = byteView[state.offset + 1];
				state.offset = state.offset + (2);
				break;
			}
			case 25: {
				if (options.dryRun !== true)
					value = readUint16(byteView, state.offset + 1);
				state.offset = state.offset + (3);
				break;
			}
			case 26: {
				if (options.dryRun !== true)
					value = readUint32(byteView, state.offset + 1);
				state.offset = state.offset + (5);
				break;
			}
			case 27: {
				if (options.dryRun !== true)
					value = readUint64(byteView, state.offset + 1);
				state.offset = state.offset + (9);
				break;
			}

			// negative integers
			case 32:
			case 33:
			case 34:
			case 35:
			case 36:
			case 37:
			case 38:
			case 39:
			case 40:
			case 41:
			case 42:
			case 43:
			case 44:
			case 45:
			case 46:
			case 47:
			case 48:
			case 49:
			case 50:
			case 51:
			case 52:
			case 53:
			case 54:
			case 55: {
				if (options.dryRun !== true)
					value = (32 - 1) - byte;
				state.offset = state.offset + (1);
				break;
			}
			case 56: {
				if (options.dryRun !== true)
					value = ~byteView[state.offset + 1];
				state.offset = state.offset + (2);
				break;
			}
			case 57: {
				if (options.dryRun !== true)
					value = ~readUint16(byteView, state.offset + 1);
				state.offset = state.offset + (3);
				break;
			}
			case 58: {
				if (options.dryRun !== true)
					value = -1 - readUint32(byteView, state.offset + 1);
				state.offset = state.offset + (5);
				break;
			}
			case 59: {
				if (options.dryRun !== true)
					value = -1 - readUint64(byteView, state.offset + 1);
				state.offset = state.offset + (9);
				break;
			}

			// byte arrays (Uint8Array, ArrayBuffer, ArrayBuffer view ...)
			case 64:
			case 65:
			case 66:
			case 67:
			case 68:
			case 69:
			case 70:
			case 71:
			case 72:
			case 73:
			case 74:
			case 75:
			case 76:
			case 77:
			case 78:
			case 79:
			case 80:
			case 81:
			case 82:
			case 83:
			case 84:
			case 85:
			case 86:
			case 87: {
				byteLength = -64 + byte;
				value = new Uint8Array(byteView.buffer, state.offset + 1, byteLength);
				state.offset = state.offset + (1 + byteLength);
				break;
			}
			case 88: {
				byteLength = byteView[state.offset + 1];
				value = new Uint8Array(byteView.buffer, state.offset + 2, byteLength);
				state.offset = state.offset + (2 + byteLength);
				break;
			}
			case 89: {
				byteLength = readUint16(byteView, state.offset + 1);
				value = new Uint8Array(byteView.buffer, state.offset + 3, byteLength);
				state.offset = state.offset + (3 + byteLength);
				break;
			}
			case 90: {
				byteLength = readUint32(byteView, state.offset + 1);
				value = new Uint8Array(byteView.buffer, state.offset + 5, byteLength);
				state.offset = state.offset + (5 + byteLength);
				break;
			}
			case 91: {
				byteLength = readUint64(byteView, state.offset + 1);
				value = new Uint8Array(byteView.buffer, state.offset + 9, byteLength);
				state.offset = state.offset + (9 + byteLength);
				break;
			}

			// cases 92 - 94 undefined

			case 95: {
				state.offset = state.offset + (1);
				values = [];

				nextValue = decodeElement(byteView, state, options);
				while ( nextValue !== breakIndicator) {
					if (!(nextValue instanceof NonCodingIndicator)) {
						if (!(nextValue instanceof Uint8Array))
							throw new Error((typeof nextValue) + " encountered when decoding value of indefinite byte array element.");
						values.push(nextValue);
					}
					nextValue = decodeElement(byteView, state, options);
				}

				if (values.length === 0) {
					value = emptyByteArray;
					break;

				}
				if (values.length === 1) {
					value = values[0];
					break;
				}
				else {
					byteLength = 0;
					for (let i = 0; i < values.length; ++i)
						byteLength = byteLength + (values[i].byteLength);
					valueView = new Uint8Array(byteLength);
					value = valueView.buffer;
					offset = 0;
					current = undefined;
					currentLength = undefined;
					for (i = 0; i < values.length; ++i) {
						current = values[i];
						currentLength = current.byteLength;
						valueView.set(current, offset);
						offset = offset + (currentLength);
					}
					break;
				}
			}


			// utf-8 strings
			case  96:
			case  97:
			case  98:
			case  99:
			case 100:
			case 101:
			case 102:
			case 103:
			case 104:
			case 105:
			case 106:
			case 107:
			case 108:
			case 109:
			case 110:
			case 111:
			case 112:
			case 113:
			case 114:
			case 115:
			case 116:
			case 117:
			case 118:
			case 119: {
				byteLength = -96 + byte;
				state.offset = state.offset + (1);
				value = decodeBytesAsUtf8String(byteView, state, byteLength, options);
				break;
			}
			case 120: {
				byteLength = byteView[state.offset + 1];
				state.offset = state.offset + (2);
				value = decodeBytesAsUtf8String(byteView, state, byteLength, options);
				break;
			}
			case 121: {
				byteLength = readUint16(byteView, state.offset + 1);
				state.offset = state.offset + (3);
				value = decodeBytesAsUtf8String(byteView, state, byteLength, options);
				break;
			}
			case 122: {
				byteLength = readUint32(byteView, state.offset + 1);
				state.offset = state.offset + (5);
				value = decodeBytesAsUtf8String(byteView, state, byteLength, options);
				break;
			}
			case 123: {
				byteLength = readUint64(byteView, state.offset + 1);
				state.offset = state.offset + (9);
				value = decodeBytesAsUtf8String(byteView, state, byteLength, options);
				break;
			}

			case 127: {
				state.offset = state.offset + (1);
				values = [];

				nextValue = decodeElement(byteView, state, options);
				while (nextValue !== breakIndicator) {
					if (!(nextValue instanceof NonCodingIndicator)){
						if (typeof nextValue !== 'string' && options.indefiniteStringNonStrings !== true)
							throw new Error("Non-string encountered when decoding value of indefinite string element.");
						values.push(nextValue);
					}
					nextValue = decodeElement(byteView, state, options);
				}

				value = values.join('');
				break;
			}

			case 128:
			case 129:
			case 130:
			case 131:
			case 132:
			case 133:
			case 134:
			case 135:
			case 136:
			case 137:
			case 138:
			case 139:
			case 140:
			case 141:
			case 142:
			case 143:
			case 144:
			case 145:
			case 146:
			case 147:
			case 148:
			case 149:
			case 150:
			case 151: {
				elementCount = -128 + byte;
                state.offset = state.offset + (1);
                next = state.next;
				state.next = undefined;
                if (next !== Set)
                    value = parseFixedLengthArray(byteView, state, elementCount, options);
                else
                    value = parseFixedLengthSet(byteView, state, elementCount, options);
				break;
			}
			case 152: {
				elementCount = byteView[state.offset + 1];
                state.offset = state.offset + (2);
                next = state.next;
				state.next = undefined;
                if (next !== Set)
                    value = parseFixedLengthArray(byteView, state, elementCount, options);
                else
                    value = parseFixedLengthSet(byteView, state, elementCount, options);
				break;
			}
			case 153: {
				elementCount = readUint16(byteView, state.offset + 1);
                state.offset = state.offset + (3);
                next = state.next;
				state.next = undefined;
                if (next !== Set)
                    value = parseFixedLengthArray(byteView, state, elementCount, options);
                else
                    value = parseFixedLengthSet(byteView, state, elementCount, options);
				break;
			}
			case 154: {
				elementCount = readUint32(byteView, state.offset + 1);
                state.offset = state.offset + (5);
                next = state.next;
				state.next = undefined;
                if (next !== Set)
                    value = parseFixedLengthArray(byteView, state, elementCount, options);
                else
                    value = parseFixedLengthSet(byteView, state, elementCount, options);
				break;
			}
			case 155: {
				elementCount = readUint64(byteView, state.offset + 1);
                state.offset = state.offset + (9);
                next = state.next;
				state.next = undefined;
                if (next !== Set)
                    value = parseFixedLengthArray(byteView, state, elementCount, options);
                else
                    value = parseFixedLengthSet(byteView, state, elementCount, options);
				break;
			}

			case 159: {
				state.offset = state.offset + (1);
                next = state.next;
                state.next = undefined;
			    if (next !== Set) {
                    value = [];

			        nextValue = decodeElement(byteView, state, options);
			        while (nextValue !== breakIndicator) {
			            if (!(nextValue instanceof NonCodingIndicator))
			                value.push(nextValue);
			            nextValue = decodeElement(byteView, state, options);
			        }
			    }
			    else {
			        value = new Set();

			        nextValue = decodeElement(byteView, state, options);
			        while (nextValue !== breakIndicator) {
			            if (!(nextValue instanceof NonCodingIndicator))
			                value.add(nextValue);
			            nextValue = decodeElement(byteView, state, options);
			        }

			    }

			    break;
			}

			case 160:
			case 161:
			case 162:
			case 163:
			case 164:
			case 165:
			case 166:
			case 167:
			case 168:
			case 169:
			case 170:
			case 171:
			case 172:
			case 173:
			case 174:
			case 175:
			case 176:
			case 177:
			case 178:
			case 179:
			case 180:
			case 181:
			case 182:
			case 183: {
                elementCount = -160 + byte;
                state.offset = state.offset + (1);
                next = state.next;
				state.next = undefined;
                if (next !== Map)
                    value = parseFixedLengthObject(byteView, state, elementCount, options);
                else
				    value = parseFixedLengthMap(byteView, state, elementCount, options);
				break;
			}
			case 184: {
				elementCount = byteView[state.offset + 1];
				state.offset = state.offset + (2);
                next = state.next;
				state.next = undefined;
                if (next !== Map)
                    value = parseFixedLengthObject(byteView, state, elementCount, options);
                else
                    value = parseFixedLengthMap(byteView, state, elementCount, options);
				break;
			}
			case 185: {
				elementCount = readUint16(byteView, state.offset + 1);
				state.offset = state.offset + (3);
                next = state.next;
				state.next = undefined;
                if (next !== Map)
                    value = parseFixedLengthObject(byteView, state, elementCount, options);
                else
                    value = parseFixedLengthMap(byteView, state, elementCount, options);
				break;
			}
			case 186: {
				elementCount = readUint32(byteView, state.offset + 1);
				state.offset = state.offset + (5);
                next = state.next;
				state.next = undefined;
                if (next !== Map)
                    value = parseFixedLengthObject(byteView, state, elementCount, options);
                else
                    value = parseFixedLengthMap(byteView, state, elementCount, options);
				break;
			}
			case 187: {
				elementCount = readUint64(byteView, state.offset + 1);
				state.offset = state.offset + (9);
                next = state.next;
				state.next = undefined;
                if (next !== Map)
                    value = parseFixedLengthObject(byteView, state, elementCount, options);
                else
                    value = parseFixedLengthMap(byteView, state, elementCount, options);
				break;
			}

			case 191: {
                state.offset = state.offset + (1);
                next = state.next;
				state.next = undefined;
                if (next !== Map) {
                    value = Object.create(null);

                    nextKey = decodeElement(byteView, state, options);
                    while (nextKey !== breakIndicator) {
                        if (nextKey instanceof NonCodingIndicator) continue;


                        nextValue = decodeElement(byteView, state, options);
                        while (nextValue !== breakIndicator) {
                            if (!(nextValue instanceof NonCodingIndicator)) {
                                value[nextKey] = nextValue;
                                break;
                            }
                            nextValue = decodeElement(byteView, state, options);
                        }
                        if (nextValue === breakIndicator) {
                            if (options.doNotThrow !== true)
                                throw new Error("Break indicator encountered when decoding value of indefinite map element for object.");
                        }

                        nextKey = decodeElement(byteView, state, options);
                    }
                }
                else {
                    value = new Map();

                    nextKey = decodeElement(byteView, state, options);
                    while (nextKey !== breakIndicator) {
                        if (nextKey instanceof NonCodingIndicator) continue;


                        nextValue = decodeElement(byteView, state, options);
                        while (nextValue !== breakIndicator) {
                            if (!(nextValue instanceof NonCodingIndicator)) {
                                value.set(nextKey, nextValue);
                                break;
                            }
                            nextValue = decodeElement(byteView, state, options);
                        }
                        if (nextValue === breakIndicator) {
                            if (options.doNotThrow !== true)
                                throw new Error("Break indicator encountered when decoding value of indefinite map element for map.");
                        }

                        nextKey = decodeElement(byteView, state, options);
                    }
                }
				break;
			}


			// tags:
			case 192: // tag 0, Text based date and time
			case 193: // tag 1, Epoch based date and time
			case 194: // tag 2, Positive big number
			case 195: // tag 3, Negative big number
			case 196: // tag 4, Decimal fraction not yet implemented
			case 197: // tag 5, big floating point

			case 198:
			case 199:
			case 200:
			case 201:
			case 202:
			case 203:
			case 204:
			case 205:
			case 206:
			case 207:
			case 208:
			case 209:
			case 210:
			case 211:
			case 212: // tags 6 to 20, unassigned

			// unofficial:
			// unique back-references:
			// tag 6: binary back-reference
			// tag 7: string back-reference
			// tag 8: array back-reference
			// tag 9: map back-reference

			// duplicating back-references:
			// tag 10: binary back-reference
			// tag 11: string back-reference
			// tag 12: array back-reference
			// tag 13: map back-reference

			// small duplicating back-references:
			// tag 14: 64-bit element back-reference
			// tag 15: 32-bit element back-reference
			// tag 16: 16-bit element back-reference

			case 213:
			case 214:
			case 215: // tags 21 to 23, base64url, base64, base16 (upperCase)
			{
				state.offset = state.offset + (1);
				if (options.dryRun !== true)
					value = parseTag(byte - 192, byteView, state, options);
				break;
			}
			case 216: {
				// tag 24: embedded CBOR element
				// tags 25 to 31, unassigned
				// tag 32, URI text
				// tag 33, base64url text
				// tag 34, base64 text
				// tag 35, regex
				// tag 36, MIME message
				// tags 37 to 55798, unassigned
				// tag 55799, self-describing CBOR
				// tags 55800 and up, unassigned

				// unofficial:
				// 126: explicit conversion of binary string to base16 (lowerCase) string
				// 127: following map is a 'Map'
				// 128: following array is a 'Set'
				// 129: following binary string is a 'Int8Array'
				// 130: following binary string is a 'Uint8Array'
				// 131: following binary string is a 'Uint8ClampedArray'
				// 132: following binary string or array is a 'Int16Array'
				// 133: following binary string or array is a 'Uint16Array'
				// 134: following binary string or array is a 'Int32Array'
				// 135: following binary string or array is a 'Uint32Array'
				// 136: following binary string or array is a 'Float32Array'
				// 137: following binary string or array is a 'Float64Array'
				// 138: following binary string or array is a 'DataView'
				// 139: following string, binary string or array is a 'Buffer'
				// 270: following element is a boxed version of a simple type (e.g. Number, Boolean, String)
				// 141: the following string is a named shared Symbol
				// 142: the following string is a named unshared Symbol

				state.offset = state.offset + (2);
				if (options.dryRun !== true)
					value = parseTag(byteView[state.offset - 1], byteView, state, options);
				break;
			}
			case 217: {
				state.offset = state.offset + (3);
				if (options.dryRun !== true)
					value = parseTag(readUint16(byteView, state.offset - 2), byteView, state, options);
				break;
			}
			case 218: {
				state.offset = state.offset + (5);
				if (options.dryRun !== true)
					value = parseTag(readUint32(byteView, state.offset - 4), byteView, state, options);
				break;
			}
			case 219: {
				state.offset = state.offset + (9);
				if (options.dryRun !== true)
					value = parseTag(readUint64(byteView, state.offset - 8), byteView, state, options);
				break;
			}
			case 224:
			case 225:
			case 226:
			case 227:
			case 228:
			case 229:
			case 230:
			case 231:
			case 232:
			case 233:
			case 234:
			case 235:
			case 236:
			case 237:
			case 238:
			case 239:
			case 240:
			case 241:
			case 242:
			case 243: {
				if (options.dryRun !== true) {
					value = parseSimpleValue(byte - 224, byteView, state, options);
					value = tagIndicator;
				}
				state.offset = state.offset + (1);
				break;
			}
			case 244: {
				value = false;
				state.offset = state.offset + (1);
				break;
			}
			case 245: {
				value = true;
				state.offset = state.offset + (1);
				break;
			}
			case 246: {
				value = null;
				state.offset = state.offset + (1);
				break;
			}
			case 247: {
				value = undefined;
				state.offset = state.offset + (1);
				break;
			}
			case 248: {
				state.offset = state.offset + (2);
				if (options.dryRun !== true)
					value = parseSimpleValue(byteView[state.offset - 1], byteView, state, options);
				break;
			}
			case 249: { // fp16
				if (options.dryRun !== true)
					decodeFloat16(readUint16(byteView, state.offset + 1));
				state.offset = state.offset + (3);
				break;
			}
			case 250: { // fp32
				if (options.dryRun !== true) {
					smallBufferUint32[0] = readUint32(byteView, state.offset + 1);
					value = smallBufferFloat32[0];
				}
				state.offset = state.offset + (3);
				break;
			}
			case 251: { // fp64
				if (options.dryRun === true) {
					state.offset = state.offset + (9);
					break;
				}
				state.offset = state.offset + (1);
				for (i = 0; i < 8; ++i)
					smallBuffer8Bytes[i] = byteView[state.offset++];
				value = smallBufferFloat64[0];
				break;
			}
			case 255: {
				state.break = true;
				state.offset = state.offset + (1);
				value = breakIndicator;
				break;
			}
		}

		return (
			options.dryRun === true
				? undefined
				: value
		);
	}

	/**
	 *
	 * @param {ArrayBuffer|Int8Array|Uint8Array|Uint8ClampedArray|Int16Array|Uint16Array|Int32Array|Uint32Array|Float32Array|Float64Array|DataView|Buffer} buffer
	 * @param {Object} [options]
	 * @returns {*}
	 */
	function decode(buffer, options) {
		if (arguments.length < 2 || options === null || typeof options !== 'object')
			options = emptyObject;
		if (buffer === undefined || buffer === null) {
			if (options.doNotThrow !== true)
				throw new Error("No buffer specified.");
			else
				return undefined;
		}
		if (ArrayBuffer.isView(buffer))
			buffer = buffer.buffer;
		if (buffer.constructor !== ArrayBuffer) {
			if (options.doNotThrow !== true)
				throw new Error("Buffer must be an ArrayBuffer or ArrayBuffer View.");
			else
				return undefined;
		}
		if (options === undefined || options === null || typeof options !== 'object')
			options = Object.create(null);
		const offset = options.offset || 0;
        const length = options.length || buffer.byteLength;
        const byteView = new Uint8Array(buffer);
        const state = Object.setPrototypeOf({offset: offset, end: offset + length}, null);

		let value;
		do {
			value = decodeElement(byteView, state, options);
			if (value === errorIndicator)
				return undefined;
		} while (state.offset < state.end && value instanceof NonCodingIndicator);

		if (options.allowRemainingBytes === true) {

			if (state.offset <= state.end) {
				value = [value];
				do {
                    value.push(decodeElement(byteView, state, options));
				} while (state.offset <= state.end);
			}
		}

		return options.dryRun === true
			? state.offset - offset
			: value;

	}

	function fixUndefinedSymbols() {
		//if (typeof root.Symbol === 'undefined')
		//	throw new Error('Symbols are not supported.');
		const wellKnownSymbols = [
			'iterator', 'match', 'replace', 'search',
			'split', 'hasInstance', 'isConcatSpreadable',
			'unscopables', 'species', 'toPrimitive',
			'toStringTag'
		];
		for (const symbolName of wellKnownSymbols) {
			if (symbolName in Symbol) continue;
			console.warn(`Symbol.${symbolName} is missing, plugging with a weak polyfill...`);
			Symbol[symbolName] = Symbol(`Symbol(Symbol.${symbolName})`);
		}
	}

	fixUndefinedSymbols();
	initBase64Lookups();
	initUtf8Codec();

	// API
	CBOR['encode'] = encode;
	CBOR['decode'] = decode;

	CBOR['decodeElement'] = decodeElement;
	CBOR['encodeElement'] = encodeElement;

	CBOR['NonCodingIndicator'] = NonCodingIndicator;
	CBOR['NonCodingIndicator'] = SelfDescribingIndicator;
	CBOR['ErrorIndicator'] = ErrorIndicator;
	CBOR['BreakIndicator'] = BreakIndicator;
	CBOR['TagIndicator'] = TagIndicator;
	CBOR['UnknownSimpleValue'] = UnknownSimpleValue;

	CBOR['optionDescriptions'] = optionDescriptions;

	//noinspection JSUnusedAssignment
	CBOR['decodeBytesAsUtf8String'] = decodeBytesAsUtf8String;
	//noinspection JSUnusedAssignment
	CBOR['decodeBytesAsHexString'] = decodeBytesAsHexString;
	//noinspection JSUnusedAssignment
	CBOR['decodeBytesAsBase64String'] = decodeBytesAsBase64String;

	//noinspection JSUnusedAssignment
	CBOR['encodeUtf8StringAsBytes'] = encodeUtf8StringAsBytes;
	//noinspection JSUnusedAssignment
	CBOR['encodeHexStringAsBytes'] = encodeHexStringAsBytes;
	//noinspection JSUnusedAssignment
	CBOR['encodeBase64StringAsBytes'] = encodeBase64StringAsBytes;

	CBOR['decodeFloat16'] = decodeFloat16;

	Object.freeze(CBOR);

	// module exposure
	{
		const moduleObj = CBOR;
		const moduleName = moduleObj.name;
		//noinspection JSUnresolvedVariable
		if (typeof define === 'function' && define.amd) {
			//noinspection JSUnresolvedFunction
			define(() => moduleObj);
		} else { //noinspection JSUnresolvedVariable
			if (typeof module !== 'undefined' && module != null) {
				//noinspection JSUnresolvedVariable
				module.exports = moduleObj
			} else { //noinspection JSUnresolvedVariable
				if (typeof angular !== 'undefined' && angular != null) {
					//noinspection JSUnresolvedVariable,JSUnresolvedFunction
					angular.module(moduleName, [])
						.factory(moduleName, () => moduleObj);
				} else {
					root[moduleName] = moduleObj;
				}
			}
		}
	}
})();