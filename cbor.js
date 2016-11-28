(function (root) {
	'use strict';

	const cbor = Object.create(null);

	const optionDescriptions = Object.freeze(Object.setPrototypeOf({
		dryRun: "No transcoding will be performed, only the length of the encoded size will be returned.",
		selfDescribing: "The encoded result will begin with the CBOR self-description tag. (Larger output)",
		noExplicitConversion: "Explicit conversion will not be performed. (Larger output)",
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
		decomposedStrings: "Construct strings using non-string types and conversion tags. (Needs indefiniteStringNonStrings)",
		throwOnUnsupportedTag: "Specifies if an error should be thrown upon encountering an unknown tag.",
		throwOnUnsupportedSimpleValue: "Specifies if an error should be thrown upon encountering an unknown simple value.",
		encodeDatesAsStrings: "Encode all dates as strings with appropriate tagging instead of numbers. (Larger output)",
		unknownSimpleValueParser: "A function that decodes an unknown simple value given the context.",
		unknownTagParser: "A function that decodes an unknown tag given the context.",
	}, null));

	const POW_2_24 = Math.pow(2, 24);
	const POW_2_32 = Math.pow(2, 32);

	/** @type {object} */
	const emptyObject = Object.freeze(Object.create(null));
	//noinspection JSValidateTypes
	/** @type {Array} */
	const emptyArray = Object.freeze([]);
	//noinspection JSValidateTypes
	/** @type {Uint8Array} */
	const emptyByteArray = Object.freeze(new Uint8Array(0));

	class NonCodingIndicator {
		//noinspection JSUnusedGlobalSymbols
		static get instance() {
			return nonCodingIndicator;
		}
	}
	class SelfDescribingIndicator extends NonCodingIndicator {
		//noinspection JSUnusedGlobalSymbols
		static get instance() {
			return selfDescribingIndicator;
		}
	}
	class ErrorIndicator extends NonCodingIndicator {
		//noinspection JSUnusedGlobalSymbols
		static get instance() {
			return errorIndicator;
		}
	}
	class BreakIndicator extends NonCodingIndicator {
		//noinspection JSUnusedGlobalSymbols
		static get instance() {
			return breakIndicator;
		}
	}
	class TagIndicator extends NonCodingIndicator {
		//noinspection JSUnusedGlobalSymbols
		static get instance() {
			return tagIndicator;
		}
	}
	const nonCodingIndicator = Object.freeze(new NonCodingIndicator());
	const selfDescribingIndicator = Object.freeze(new SelfDescribingIndicator());
	const errorIndicator = Object.freeze(new ErrorIndicator());
	const breakIndicator = Object.freeze(new BreakIndicator());
	const tagIndicator = Object.freeze(new TagIndicator());

	class UnknownSimpleValue {
		constructor(value) {
			this.value = value;
		}

		valueOf() {
			return this.value;
		}
	}

	const regExpForRegExps = /^\/((?:.*?(?!\\).)?)\/(.*)$/;
	const regExpForUniqueSymbols = /^Symbol\((.*)\)$/;
	const regExpForSharedSymbols = /^Symbol\.for\((.*)\)$/;

	const Buffer = typeof root.Buffer !== 'undefined' ? root.Buffer : undefined;

	const smallBuffer = new ArrayBuffer(8);
	//noinspection JSCheckFunctionSignatures // broken signature check
	const smallBufferFloat64 = new Float64Array(smallBuffer, 0, 1);
	const smallBufferFloat32 = new Float32Array(smallBuffer, 0, 1);
	const smallBufferUint32 = new Uint32Array(smallBuffer, 0, 1);
	const smallBuffer8Bytes = new Uint8Array(smallBuffer, 0, 8);
	const smallBuffer4Bytes = new Uint8Array(smallBuffer, 0, 4);

	/**
	 *
	 * @function
	 * @param {string} string
	 * @param {Uint8Array} byteView
	 * @param {object} state
	 * @param {object} options
	 * @returns {number}
	 */
	let encodeUtf8StringAsBytes;
	/**
	 *
	 * @function
	 * @param {Uint8Array} byteView
	 * @param {object} state
	 * @param {number} byteLength
	 * @param {object} options
	 * @returns {string}
	 */
	let decodeBytesAsUtf8String;

	/**
	 *
	 * @function
	 * @param {string} string
	 * @param {Uint8Array} byteView
	 * @param {object} state
	 * @param {object} options
	 * @returns {number}
	 */
	let encodeBase64StringAsBytes;
	/**
	 *
	 * @function
	 * @param {Uint8Array} byteView
	 * @param {object} state
	 * @param {number} byteLength
	 * @param {object} options
	 * @returns {string}
	 */
	let decodeBytesAsBase64String;
	/**
	 *
	 * @function
	 * @param {string} string
	 * @returns {number}
	 */
	let detectBase64String;

	/**
	 * upper or lower, doesn't care
	 * @function
	 * @param {string} string
	 * @param {Uint8Array} byteView
	 * @param {object} state
	 * @param {object} options
	 * @returns {number}
	 */
	let encodeHexStringAsBytes;

	/**
	 *
	 * @function
	 * @param {number} byteLength
	 * @param {Uint8Array} byteView
	 * @param {object} state
	 * @param {object} options
	 * @returns {string}
	 */
	let decodeBytesAsHexString;

	/**
	 *
	 * @function
	 * @param {string} string
	 * @returns {number}
	 */
	let detectHexString;

	/**
	 * helper method that gets the byte length given the base 64 character count
	 * @param {number} encodedChars
	 * @returns {number}
	 */
	function getBase64DecodedLength(encodedChars) {
		return encodedChars - Math.ceil(encodedChars / 4);
	}

	/**
	 * helper method that gets the base 64 character count given the byte length
	 * @param {number} byteLength
	 * @returns {number}
	 */
	function getBase64EncodedCharCount(byteLength) {
		return byteLength + Math.ceil(byteLength / 3);
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
		for (let i = 0; i < charLength; /*i*/) {
			const charCode = string.charCodeAt(i);
			if (charCode < 0x80) {
				byteLength += 1;
				i += 1;
			} else if (charCode < 0x800) {
				byteLength += 2;
				i += 1;
			} else if (charCode < 0xd800) {
				byteLength += 3;
				i += 1;
			} else {
				byteLength += 4;
				i += 2;
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
		return string.charCodeAt(strLength - 2) === 61
			? strLength - 2
			: string.charCodeAt(strLength - 1) === 61
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

	/**
	 * helper method for setting members of an Object
	 * @param {object} o
	 * @param {string} k
	 * @param {*} v
	 */
	function objectSetMember(o, k, v) {
		o[k] = v;
	}

	/**
	 * helper method for setting members of a Map
	 * @param {Map} o
	 * @param k
	 * @param v
	 */
	function mapSetMember(o, k, v) {
		o.set(k, v);
	}

	//noinspection JSUnusedLocalSymbols // k is not used
	/**
	 * helper method for adding members to a Set with an unused key
	 * @param {Set} o
	 * @param {number} k
	 * @param {*} v
	 */
	function setAddMember2(o, k, v) {
		o.add(v);
	}

	/**
	 * helper method for pushing members to an Array
	 * @param {Array} o
	 * @param {*} v
	 */
	function arrayPushMember(o, v) {
		o.push(v);
	}

	/**
	 * helper method for adding members to a Set
	 * @param {Set} o
	 * @param {*} v
	 */
	function setAddMember(o, v) {
		o.add(v);
	}

	/**
	 * initialize the hexadecimal (base 16) encoder and decoder
	 */
	function initHexCodec() {

		const rxUpperCaseHexString = /^[0-9A-F]+$/;
		const rxLowerCaseHexString = /^[0-9a-f]+$/;

		/**
		 *
		 * @param {string} string
		 * @returns {number}
		 */
		function detectHexStringJS(string) {
			if (string.length === 0)
				return 0;
			if ((string.length & 1 ) !== 0)
				return 0;
			if (rxUpperCaseHexString.test(string) === true)
				return 1;
			if (rxLowerCaseHexString.test(string) === true)
				return -1;
			return 0;
		}

		/**
		 * upper or lower, doesn't care
		 * @param {string} string
		 * @param {Uint8Array} byteView
		 * @param {object} state
		 * @param {object} options
		 * @returns {number}
		 */
		function encodeHexStringAsBytesJS(string, byteView, state, options) {
			let strLength = string.length;
			if ((strLength & 1) !== 0)
				throw new Error("Hexadecimal strings must be of an even number of characters.");
			if (options.dryRun === true) {
				state.offset += strLength >>> 1;
				return strLength >>> 1;
			}
			for (let i = 0; i < strLength; i += 2) {
				let ch1 = string.charCodeAt(i);
				let ch2 = string.charCodeAt(i + 1);
				byteView[state.offset++] =
					(((ch1 & 0xF) + ( ch1 > 0x39 ? 0x9 : 0 )) << 4) |
					(ch2 & 0xF) + ( ch2 > 0x39 ? 0x9 : 0 );
			}
			return strLength >>> 1;
		}

		const upperCaseLetterDiff = ('A'.charCodeAt(0) - '9'.charCodeAt(0)) - 1;
		const lowerCaseLetterDiff = ('a'.charCodeAt(0) - '9'.charCodeAt(0)) - 1;

		/**
		 *
		 * @param {number} byteLength
		 * @param {Uint8Array} byteView
		 * @param {object} state
		 * @param {object} options
		 * @returns {string}
		 */
		function decodeBytesAsHexStringJS(byteLength, byteView, state, options) {
			if (options.dryRun === true) {
				state.offset += byteLength;
				return "";
			}
			const letterDiff = state.hexLowerCase === true ? lowerCaseLetterDiff : upperCaseLetterDiff;
			const letters = new Uint8Array(byteLength * 2);
			for (let i = 0; i < byteLength; ++i) {
				let byte = byteView[state.offset + i];
				let cv1 = (byte >>> 4) + 0x30;
				let cv2 = (byte & 0xF) + 0x30;
				if (cv1 > 0x39) cv1 += letterDiff;
				if (cv2 > 0x39) cv2 += letterDiff;
				const li = i * 2;
				letters[li] = cv1;
				letters[li + 1] = cv2;
			}
			return String.fromCharCode.apply(null, letters);
		}

		encodeHexStringAsBytes = encodeHexStringAsBytesJS;
		decodeBytesAsHexString = decodeBytesAsHexStringJS;
		detectHexString = detectHexStringJS;
	}

	/**
	 * initialize the base 64 encoder and decoder
	 */
	function initBase64Codec() {
		const rxBase64 = /^(?:[A-Za-z0-9+\/]{4})*(?:|[A-Za-z0-9+\/][AQgw]==|[A-Za-z0-9+\/]{2}[AEIMQUYcgkosw048]=)$/;
		const rxBase64Url = /^(?:[A-Za-z0-9\-_]{4})*(?:|[A-Za-z0-9\-_][AQgw]|[A-Za-z0-9+\/]{2}[AEIMQUYcgkosw048])$/;

		/**
		 *
		 * @param {string} string
		 * @returns {number}
		 */
		function detectBase64StringJS(string) {
			if (string.length === 0)
				return 0;
			if (rxBase64.test(string) === true)
				return 1;
			if (rxBase64Url.test(string) === true)
				return 2;
			return 0;
		}

		const base64ValueToCharLookup = new Uint8Array(64);
		const base64UrlValueToCharLookup = new Uint8Array(64);
		const base64CharToValueLookup = new Uint8Array(123 - 43);

		function initLookups() {
			//noinspection SpellCheckingInspection
			const charset = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
			for (let i = 0; i < 64; ++i) {
				const charCode = charset.charCodeAt(i);
				base64CharToValueLookup[charCode - 43] = i;
				base64ValueToCharLookup[i] = charCode;
			}
			base64UrlValueToCharLookup.set(base64ValueToCharLookup, 0);
			const dashCharCode = '-'.charCodeAt(0);
			const underscoreCharCode = '_'.charCodeAt(0);
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
		 * @param {object} state
		 * @param {object} options
		 * @returns {number}
		 */
		function encodeBase64StringAsBytesJS(string, byteView, state, options) {
			const charLength = getBase64CharCount(string);
			const byteLength = getBase64DecodedLength(charLength);
			if (options.dryRun === true) {
				state.offset += byteLength;
				return byteLength;
			}
			const end = state.offset + byteLength;
			for (let i = 0; i < charLength; i += 4) {
				const cv1 = getBase64CharValue(string.charCodeAt(i));
				const cv2 = getBase64CharValue(string.charCodeAt(i + 1));
				const cv3 = getBase64CharValue(string.charCodeAt(i + 2));
				const cv4 = getBase64CharValue(string.charCodeAt(i + 3));

				const threeBytes = (cv1 << 18) + (cv2 << 12) + (cv3 << 6) + cv4;

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
		 * @param {object} state
		 * @param {number} byteLength
		 * @param {object} options
		 * @returns {string}
		 */
		function decodeBytesAsBase64StringJS(byteView, state, byteLength, options) {
			if (byteLength === 0) return "";
			const end = state.offset + byteLength;
			const charCount = getBase64EncodedCharCount(byteLength);
			const charBufferSize = state.base64Url === true
				? charCount
				: getBase64EncodedLengthFromCharCount(charCount);
			if (options.dryRun === true) {
				state.offset += charBufferSize;
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
						carryBuffer |= byteView[state.offset++];
						charBuffer[charBufIdx++] = charLookup[(carryBuffer >>> 4) & 0x3f];
						break;
					}
					case 2: {
						carryBuffer <<= 8;
						carryBuffer |= byteView[state.offset++];
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

		initLookups();

		encodeBase64StringAsBytes = encodeBase64StringAsBytesJS;
		decodeBytesAsBase64String = decodeBytesAsBase64StringJS;
		detectBase64String = detectBase64StringJS;
	}

	/**
	 * initialize the utf-8 encoder and decoder
	 */
	function initUtf8Codec() {

		/**
		 *
		 * @param {string} string
		 * @param {Uint8Array} byteView
		 * @param {object} state
		 * @param {object} options
		 * @returns {number}
		 */
		function encodeUtf8StringAsBytesJSCC(string, byteView, state, options) {
			if (options.dryRun === true) {
				const size = getByteLengthOfUtf8String(string);
				state.offset += size;
				return size;
			}
			const start = state.offset;
			const charLength = string.length;
			for (let i = 0; i < charLength; ++i) {
				const codePoint = string.charCodeAt(i);
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
					const fullCodePoint =
						((codePoint & 0x3ff) << 10 |
						(string.charCodeAt(++i) & 0x3ff))
						+ 0x10000;

					byteView[state.offset++] = (0xf0 | fullCodePoint >>> 18);
					byteView[state.offset++] = (0x80 | (fullCodePoint >>> 12) & 0x3f);
					byteView[state.offset++] = (0x80 | (fullCodePoint >>> 6) & 0x3f);
					byteView[state.offset++] = (0x80 | fullCodePoint & 0x3f);
				}
			}
			return state.offset - start;
		}

		/**
		 *
		 * @param {string} string
		 * @param {Uint8Array} byteView
		 * @param {object} state
		 * @param {object} options
		 * @returns {number}
		 */
		function encodeUtf8StringAsBytesJSCP(string, byteView, state, options) {
			if (options.dryRun === true) {
				const size = getByteLengthOfUtf8String(string);
				state.offset += size;
				return size;
			}
			const start = state.offset;
			const charLength = string.length;
			for (let i = 0; i < charLength; ++i) {
				const codePoint = string.codePointAt(i);
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
		 * @function
		 * @param {string} string
		 * @param {Uint8Array} byteView
		 * @param {object} state
		 * @param {object} options
		 * @returns {number}
		 */
		const encodeUtf8StringAsBytesJS = 'codePointAt' in String.prototype
			? encodeUtf8StringAsBytesJSCP : encodeUtf8StringAsBytesJSCC;

		/**
		 *
		 * @param {Uint8Array} byteView
		 * @param {object} state
		 * @param {number} byteLength
		 * @param {object} options
		 * @returns {string}
		 */
		function decodeBytesAsUtf8StringJS(byteView, state, byteLength, options) {
			if (options.dryRun === true) {
				state.offset += byteLength;
				return "";
			}
			const startOffset = state.offset;
			const end = startOffset + byteLength;
			let offset = startOffset;

			let charLength = 0;
			while (offset < end) {
				const codePoint = byteView[offset];
				if (codePoint < 0x80) {
					charLength += 1;
					offset += 1;
				} else if (codePoint < 0xe0) {
					charLength += 1;
					offset += 2;
				} else if (codePoint < 0xf0) {
					const fullCodePoint = (codePoint & 0x0f) << 12
						| (byteView[offset + 1] & 0x3f) << 6
						| (byteView[offset + 2] & 0x3f);
					charLength += fullCodePoint < 0x10000 ? 1 : 2;
					offset += 3;
				} else {
					charLength += 2;
					offset += 4;
				}
			}

			offset = startOffset;

			let chars = new Uint16Array(charLength);
			let charIndex = 0;

			while (offset < end) {
				const codePoint = byteView[offset];
				if (codePoint < 0x80) {
					chars[charIndex++] = codePoint;
					offset += 1;
				} else if (codePoint < 0xe0) {
					chars[charIndex++] = (codePoint & 0x1f) << 6
						| (byteView[offset + 1] & 0x3f);
					offset += 2;
				} else if (codePoint < 0xf0) {
					const fullCodePoint = (codePoint & 0x0f) << 12
						| (byteView[offset + 1] & 0x3f) << 6
						| (byteView[offset + 2] & 0x3f);
					if (fullCodePoint >= 0x10000) {
						chars[charIndex++] = 0xd800 | (fullCodePoint >>> 10);
						chars[charIndex++] = 0xdc00 | (fullCodePoint & 0x3ff);
					} else {
						chars[charIndex++] = fullCodePoint;
					}
					offset += 3;
				} else {
					const fullCodePoint = ((codePoint & 0x07) << 18
						| (byteView[offset + 1] & 0x3f) << 12
						| (byteView[offset + 2] & 0x3f) << 6
						| (byteView[offset + 3] & 0x3f))
						- 0x10000;
					chars[charIndex++] = 0xd800 | (fullCodePoint >>> 10);
					chars[charIndex++] = 0xdc00 | (fullCodePoint & 0x3ff);
					offset += 4;
				}
			}

			state.offset = offset;

			return String.fromCharCode.apply(null, chars);
		}

		if ('Buffer' in root && typeof Buffer !== 'undefined') {
			encodeUtf8StringAsBytes =
				/**
				 *
				 * @param {string} string
				 * @param {Uint8Array} byteView
				 * @param {object} state
				 * @param {object} options
				 * @returns {number}
				 */
					function encodeUtf8StringAsBytesNode(string, byteView, state, options) {
					if (options.dryRun === true) {
						state.offset += getByteLengthOfUtf8String(string);
						return;
					}
					return Buffer.from(byteView.buffer).write(string, state.offset);
				};
			decodeBytesAsUtf8String =
				/**
				 *
				 * @param {Uint8Array} byteView
				 * @param {object} state
				 * @param {number} byteLength
				 * @param {object} options
				 * @returns {string}
				 */
					function decodeBytesAsUtf8StringNode(byteView, state, byteLength, options) {
					if (options.dryRun === true) {
						state.offset += byteLength;
						return "";
					}
					const result = Buffer.from(byteView.buffer, state.offset, byteLength).toString('utf8');
					state.offset += byteLength;
					return result;
				};
		} else if ('TextDecoder' in root) {
			/**
			 * @name TextDecoder
			 * @function
			 * @global
			 * @param {string} codec
			 */
			const textDecoder = new TextDecoder('utf-8');
			encodeUtf8StringAsBytes = encodeUtf8StringAsBytesJS;
			decodeBytesAsUtf8String =
				/**
				 *
				 * @param {Uint8Array} byteView
				 * @param {object} state
				 * @param {number} byteLength
				 * @param {object} options
				 * @returns {string}
				 */
					function decodeBytesAsUtf8StringNative(byteView, state, byteLength, options) {
					if (options.dryRun === true) {
						state.offset += byteLength;
						return "";
					}
					const result = textDecoder.decode(new DataView(byteView.buffer, state.offset, byteLength));
					state.offset += byteLength;
					return result;
				};
		} else {
			encodeUtf8StringAsBytes = encodeUtf8StringAsBytesJS;
			decodeBytesAsUtf8String = decodeBytesAsUtf8StringJS;
		}
	}

	/**
	 *
	 * @param {number} value
	 * @param {Uint8Array} byteView
	 * @param {object} state
	 * @param {object} options
	 */
	function encodeDouble(value, byteView, state, options) {
		if (options.dryRun === true) {
			state.offset += 9;
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
		state.offset += 9;
	}

	function encodeInteger(positive, encodedValue, byteView, state, options) {
		if (encodedValue < 24) {
			if (options.dryRun === true) {
				state.offset += 1;
			} else {
				if (positive) {
					byteView[state.offset] = encodedValue;
				} else {
					byteView[state.offset] = 0x20 | encodedValue;
				}
				state.offset += 1;
			}
		} else if (encodedValue <= 0xff) {
			if (options.dryRun === true) {
				state.offset += 2;
			} else {
				if (positive) {
					byteView[state.offset] = 0x18;
				} else {
					byteView[state.offset] = 0x38;
				}
				byteView[state.offset + 1] = encodedValue;
				state.offset += 2;
			}
		} else if (encodedValue <= 0xffff) {
			if (options.dryRun === true) {
				state.offset += 3;
			} else {
				if (positive) {
					byteView[state.offset] = 0x19;
				} else {
					byteView[state.offset] = 0x39;
				}
				byteView[state.offset + 1] = encodedValue >>> 8;
				byteView[state.offset + 2] = encodedValue & 0xff;
				state.offset += 3;
			}
		} else {
			if (options.dryRun === true) {
				state.offset += 5;
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
				state.offset += 5;
			}
			// 64-bit ints are pointless to encode in JS currently
		}
	}

	/**
	 *
	 * @param {number} value
	 * @param {Uint8Array} byteView
	 * @param {object} state
	 * @param {object} options
	 */
	function encodeNumber(value, byteView, state, options) {
		if (options.allNumbersAreDoubles === true) {
			encodeDouble(value, byteView, state, options);
			return;
		}
		if (!isFinite(value)) {
			if (options.dryRun === true) {
				state.offset += 3;
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
			state.offset += 3;
			return;
		}
		const zero = value === 0;
		const positive = ( zero && 1 / value > 0 ) || value > 0;
		const negZero = zero && positive !== true;
		if (negZero) {
			if (options.dryRun === true) {
				state.offset += 3;
				return;
			}
			byteView[state.offset] = 0xf9; // fp16
			byteView[state.offset + 1] = 0x80;
			byteView[state.offset + 2] = 0x00;
			state.offset += 3;
			return;
		}
		const integerValue = Math.floor(value);
		const encodedValue = ( positive ? integerValue : ~integerValue ) >>> 0;
		if (value === integerValue && encodedValue < POW_2_32) {
			encodeInteger(positive, encodedValue, byteView, state, options);

			return;

		} else {
			// floating point or bigger than 32-bit integer
			smallBufferFloat32[0] = value;
			const uintValue = smallBufferUint32[0];
			const unsigned = uintValue & 0x7fffffff;
			if (smallBufferFloat32[0] === value) {
				// easily translated
				if (unsigned > 0x38800000 && unsigned < 0x47000000 && (unsigned & 0x00001fff) === 0) {
					if (options.dryRun === true) {
						state.offset += 3;
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
					state.offset += 3;
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
							state.offset += 3;
							return;
						}
						byteView[state.offset] = 0xf9; // fp16
						const mantissaBits = (unsigned & mantissaAllowedMask & 0x007fffff) >>> (23 - mantissaBitsAllowed);
						const highBit = 1 << mantissaBitsAllowed;
						const signBits = (uintValue & 0x80000000) >>> 16;
						const float16Bits = signBits | highBit | mantissaBits;
						byteView[state.offset + 1] = float16Bits >>> 8;
						byteView[state.offset + 2] = float16Bits & 0xff;
						state.offset += 3;
						return;
					}
				}
				if (options.dryRun === true) {
					state.offset += 5;
					return;
				}
				byteView[state.offset] = 0xfa; // fp32
				//byteView.set(smallBuffer4Bytes, state.offset + 1); // LE
				byteView[state.offset + 1] = smallBuffer4Bytes[3];
				byteView[state.offset + 2] = smallBuffer4Bytes[2];
				byteView[state.offset + 3] = smallBuffer4Bytes[1];
				byteView[state.offset + 4] = smallBuffer4Bytes[0];
				state.offset += 5;
				return;
			}
			encodeDouble(value, byteView, state, options);
			return;
		}
		//noinspection UnreachableCodeJS
		throw new Error("Unhandled encoding of number.");
	}

	/**
	 *
	 * @param {string} value
	 * @param {Uint8Array} byteView
	 * @param {object} state
	 * @param {object} options
	 */
	function encodeString(value, byteView, state, options) {
		if (options.noExplicitConversion !== true) {
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
			if (value.length > 4) {
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
		encodeStringRaw(value, byteView, state, options);
	}


	/**
	 *
	 * @param {string} value
	 * @param {Uint8Array} byteView
	 * @param {object} state
	 * @param {object} options
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
		encodePrefix(64, value.byteLength, byteView, state, options);
		encodeBuffer(value.buffer, byteView, state, options, value.byteOffset, value.byteLength);
	}

	/**
	 *
	 * @param {number} baseValue
	 * @param {number} value
	 * @param {Uint8Array} byteView
	 * @param {object} state
	 * @param {object} options
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
				state.offset += 1;
				return;
			}
			byteView[state.offset++] = baseValue + value;
		} else if (value < 256) {
			if (options.dryRun === true) {
				state.offset += 2;
				return;
			}
			byteView[state.offset++] = baseValue + 24;
			byteView[state.offset++] = value;
		} else if (value < 65536) {
			if (options.dryRun === true) {
				state.offset += 3;
				return;
			}
			byteView[state.offset++] = baseValue + 25;
			byteView[state.offset++] = value >>> 8;
			byteView[state.offset++] = value;
		} else if (value < POW_2_32) {
			if (options.dryRun === true) {
				state.offset += 5;
				return;
			}
			byteView[state.offset++] = baseValue + 27;
			byteView[state.offset++] = value >>> 24;
			byteView[state.offset++] = value >>> 16;
			byteView[state.offset++] = value >>> 8;
			byteView[state.offset++] = value;
		} else {
			if (options.dryRun === true) {
				state.offset += 9;
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
	 * @param {object} state
	 * @param {object} options
	 */
	function encodeTag(value, byteView, state, options) {
		encodePrefix(192, value, byteView, state, options);
	}

	/**
	 *
	 * @param {number} value
	 * @param {Uint8Array} byteView
	 * @param {object} state
	 * @param {object} options
	 */
	function encodeSimpleValue(value, byteView, state, options) {
		encodePrefix(224, value, byteView, state, options);
	}

	/**
	 *
	 * @param {ArrayBuffer} value
	 * @param {Uint8Array} byteView
	 * @param {object} state
	 * @param {object} options
	 * @param {number} valueOffset
	 * @param {number} valueLength
	 */
	function encodeBuffer(value, byteView, state, options, valueOffset, valueLength) {
		if (options.dryRun) {
			state.offset += valueLength;
			return;
		}
		const source = new Uint8Array(value, valueOffset, valueLength);
		const destination = new Uint8Array(byteView.buffer, byteView.byteOffset + state.offset, valueLength);
		destination.set(source);
	}

	/**
	 *
	 * @param {Set} set
	 * @param {Uint8Array} byteView
	 * @param {object} state
	 * @param {object} options
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
	 * @param {Array} value
	 * @param {Uint8Array} byteView
	 * @param {object} state
	 * @param {object} options
	 */
	function encodeArray(value, byteView, state, options) {
		const memberCount = value.length;
		encodePrefix(128, memberCount, byteView, state, options);
		for (let i = 0; i < memberCount; ++i) {
			const member = value[i];
			encodeElement(member, byteView, state, options);
		}
	}

	/**
	 *
	 * @param {Map} map
	 * @param {Uint8Array} byteView
	 * @param {object} state
	 * @param {object} options
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
		const firstCharCode = string.charCodeAt(0);
		if ( firstCharCode === 0x30 )
			return string.length === 1;
		let isCharNumeric = isNumericChar(firstCharCode);
		if (string.length > 1 && isCharNumeric) {
			let i = 1;
			do {
				isCharNumeric = isNumericChar(string.charCodeAt(i));
			} while (isCharNumeric && i < string.length);
		}
		return isCharNumeric;
	}

	/**
	 *
	 * @param {string} string
	 * @param {Uint8Array} byteView
	 * @param {object} state
	 * @param {object} options
	 */
	function encodeStringMaybeInteger(string, byteView, state, options) {

		const isPosInt = isPositiveIntegerString(string);

		if (isPosInt)
			encodeInteger(true, parseInt(string, 10), byteView, state, options);
		else
			encodeString(string, byteView, state, options);
	}

	/**
	 *
	 * @param {object} value
	 * @param {Uint8Array} byteView
	 * @param {object} state
	 * @param {object} options
	 */
	function encodeObject(value, byteView, state, options) {
		const keys = Object.keys(value);
		const memberCount = keys.length;
		encodePrefix(160, memberCount, byteView, state, options);
		for (let i = 0; i < memberCount; ++i) {
			const key = keys[i];
			const member = value[key];
			encodeStringMaybeInteger(key, byteView, state, options);
			encodeElement(member, byteView, state, options);
		}
	}

	/**
	 *
	 * @param {*} value
	 * @param {Uint8Array} byteView
	 * @param {object} state
	 * @param {object} options
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
								encodeNumber(value.valueOf() / 1000, byteView, state, options);
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
							encodeObject(emptyObject, byteView, state, options);
							break;
						}
						if (value instanceof WeakSet) {
							encodeArray(emptyArray, byteView, state, options);
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
	 * @param {object} [options]
	 * @returns {number|ArrayBuffer}
	 */
	function encode(value, options) {
		if (arguments.length < 2 || options === null || typeof options !== 'object')
			options = emptyObject;
		const state = {offset: 0};

		let buffer = null;
		let byteView = null;

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
			        ? sign * Math.pow(2, ( (expoBits >>> 10) - 25 )) * (fraction + 0x0400)
			        : fraction !== 0
					  ? NaN
					  : sign * Infinity
		);
	}

	/**
	 *
	 * @param {Uint8Array} byteView
	 * @param {object} state
	 * @param {number} elementCount
	 * @param {object} options
	 * @returns {Array|Set}
	 */
	function parseFixedLengthArray(byteView, state, elementCount, options) {
		const setMember = state.next === undefined ? objectSetMember : setAddMember2;
		const value = state.next === undefined ? new Array(elementCount) : new state.next();
		delete state.next;

		for (let i = 0; i < elementCount; ++i)
			setMember(value, i, decodeElement(byteView, state, options));

		return value;
	}

	/**
	 *
	 * @param {Uint8Array} byteView
	 * @param {object} state
	 * @param {number} elementCount
	 * @param {object} options
	 * @returns {object|Map}
	 */
	function parseFixedLengthMap(byteView, state, elementCount, options) {
		const setMember = state.next === undefined ? objectSetMember : mapSetMember;
		const value = state.next === undefined ? Object.create(null) : new state.next();
		delete state.next;

		for (let i = 0; i < elementCount; ++i) {
			const nextKey = decodeElement(byteView, state, options);
			if (nextKey === breakIndicator) {
				if (options.doNotThrow !== true)
					throw new Error("Break indicator encountered when decoding key fixed-length map element.");
				--i;
				continue;
			}
			if (nextKey instanceof NonCodingIndicator) continue;
			for (; ;) {
				const nextValue = decodeElement(byteView, state, options);
				if (nextValue === breakIndicator) {
					if (options.doNotThrow !== true)
						throw new Error("Break indicator encountered when decoding value of map element.");
				}
				if (nextValue instanceof NonCodingIndicator) continue;
				setMember(value, nextKey, nextValue); // value[nextKey] = nextValue;
				break;
			}
		}
		return value;
	}

	/**
	 * https://www.iana.org/assignments/cbor-tags/cbor-tags.xhtml
	 * @param {number} tag
	 * @param {Uint8Array} byteView
	 * @param {object} state
	 * @param {object} options
	 * @returns {*}
	 */
	function parseTag(tag, byteView, state, options) {
		switch (tag) {
			// tag 0, Text based date and time
			case 0: {
				const dateString = decodeElement(byteView, state, options);
				if (typeof dateString != 'string')
					throw new Error("Date tagged as encoded as string, but is " + (typeof dateString));
				return new Date(dateString);
			}
			// tag 1, Epoch based date and time
			case 1: {
				const dateValue = decodeElement(byteView, state, options);
				if (typeof dateValue != 'number')
					throw new Error("Date tagged as encoded as number, but is " + (typeof dateValue));
				return new Date(dateValue * 1000);
			}
			// tag 2, Positive big number
			// tag 3, Negative big number
			// tag 4, Decimal fraction
			// tag 5, big floating point
			case 2:
			case 3:
			case 4: {
				if (options.throwOnUnsupportedTag === true)
					throw new Error("Arbitrary precision numbers not yet implemented");
				break;
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
			case 22: {
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
			case 23: {
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

			// tag 24: embedded CBOR element
			case 24: {
				const byteArray = decodeElement(byteView, state, options);
				if (!(byteArray instanceof Uint8Array )) {
					if (options.doNotThrow !== true)
						throw new Error("Embedded CBOR element conversion tag encoded value is not given as byte array.");
					return byteArray;
				}
				return decode(byteArray, options);
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
			// tag 36, MIME message
			// tags 37 to 55798, unassigned
			// tag 55799, self-describing CBOR
			case 55799: {
				// full 3 bytes: tag 0xD9, data 0xD9, 0xF7
				if (state.offset !== 1) {
					if (options.doNotThrow !== true)
						throw new Error("Encountered CBOR self-description tag sequence, but not at the start of the stream.");
				}
				return selfDescribingIndicator;
			}
			// tags 55800 and up, unassigned

			// unofficial:
			// 126: explicit conversion of binary string to base16 (lower case) string
			case 126: {
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
			// 127: following map is a 'Map'
			case 127: {
				state.next = Map;
				const map = decodeElement(byteView, state, options);
				if (!(map instanceof Map )) {
					if (options.doNotThrow !== true)
						throw new Error("Map tag encoded value is not given as a map.");
					delete state.next;
				}
				return map;
			}
			// 128: following array is a 'Set'
			case 128: {
				state.next = Set;
				const set = decodeElement(byteView, state, options);
				if (!(set instanceof Set )) {
					if (options.doNotThrow !== true)
						throw new Error("Set tag encoded value is not given as an array.");
					delete state.next;
				}
				return set;
			}
			// 129: following binary string is an 'Int8Array'
			case 129: {
				const byteArray = decodeElement(byteView, state, options);
				if (!(byteArray instanceof Uint8Array )) {
					if (options.doNotThrow !== true)
						throw new Error("Int8Array tag encoded value is not given as byte array.");
					return byteArray;
				}
				return new Int8Array(byteArray.buffer, byteArray.byteOffset, byteArray.byteLength);
			}
			// 130: following binary string is an 'ArrayBuffer'
			case 130: {
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
			// 131: following binary string is an 'Uint8ClampedArray'
			case 131: {
				const byteArray = decodeElement(byteView, state, options);
				if (!(byteArray instanceof Uint8Array )) {
					if (options.doNotThrow !== true)
						throw new Error("Uint8ClampedArray tag encoded value is not given as byte array.");
					return byteArray;
				}
				//noinspection JSCheckFunctionSignatures // bad inspection
				return new Uint8ClampedArray(byteArray.buffer, byteArray.byteOffset, byteArray.byteLength);
			}
			// 132: following binary string or array is an 'Int16Array'
			case 132: {
				const byteArray = decodeElement(byteView, state, options);
				if (!(byteArray instanceof Uint8Array )) {
					if (options.doNotThrow !== true)
						throw new Error("Int16Array tag encoded value is not given as byte array.");
					return byteArray;
				}
				return new Int16Array(byteArray.buffer, byteArray.byteOffset, byteArray.byteLength);
			}
			// 133: following binary string or array is an 'Uint16Array'
			case 133: {
				const byteArray = decodeElement(byteView, state, options);
				if (!(byteArray instanceof Uint8Array )) {
					if (options.doNotThrow !== true)
						throw new Error("Uint16Array tag encoded value is not given as byte array.");
					return byteArray;
				}
				return new Uint16Array(byteArray.buffer, byteArray.byteOffset, byteArray.byteLength);
			}
			// 134: following binary string or array is an 'Int32Array'
			case 134: {
				const byteArray = decodeElement(byteView, state, options);
				if (!(byteArray instanceof Uint8Array )) {
					if (options.doNotThrow !== true)
						throw new Error("Int32Array tag encoded value is not given as byte array.");
					return byteArray;
				}
				return new Int32Array(byteArray.buffer, byteArray.byteOffset, byteArray.byteLength);
			}
			// 135: following binary string or array is an 'Uint32Array'
			case 135: {
				const byteArray = decodeElement(byteView, state, options);
				if (!(byteArray instanceof Uint8Array )) {
					if (options.doNotThrow !== true)
						throw new Error("Uint32Array tag encoded value is not given as byte array.");
					return byteArray;
				}
				return new Uint32Array(byteArray.buffer, byteArray.byteOffset, byteArray.byteLength);
			}
			// 136: following binary string or array is a 'Float32Array'
			case 136: {
				const byteArray = decodeElement(byteView, state, options);
				if (!(byteArray instanceof Uint8Array )) {
					if (options.doNotThrow !== true)
						throw new Error("Float32Array tag encoded value is not given as byte array.");
					return byteArray;
				}
				return new Float32Array(byteArray.buffer, byteArray.byteOffset, byteArray.byteLength);
			}
			// 137: following binary string or array is a 'Float64Array'
			case 137: {
				const byteArray = decodeElement(byteView, state, options);
				if (!(byteArray instanceof Uint8Array )) {
					if (options.doNotThrow !== true)
						throw new Error("Float64Array tag encoded value is not given as byte array.");
					return byteArray;
				}
				return new Float64Array(byteArray.buffer, byteArray.byteOffset, byteArray.byteLength);
			}
			// 138: following binary string or array is a 'DataView'
			case 138: {
				const byteArray = decodeElement(byteView, state, options);
				if (!(byteArray instanceof Uint8Array )) {
					if (options.doNotThrow !== true)
						throw new Error("DataView tag encoded value is not given as byte array.");
					return byteArray;
				}
				return new DataView(byteArray.buffer, byteArray.byteOffset, byteArray.byteLength);
			}
			// 139: following string, binary string or array is a 'Buffer'
			case 139: {
				if (typeof Buffer === 'undefined')
					return nonCodingIndicator;

				const byteArray = decodeElement(byteView, state, options);
				if (!(byteArray instanceof Uint8Array )) {
					if (options.doNotThrow !== true)
						throw new Error("Buffer tag encoded value is not given as byte array.");
					return byteArray;
				}
				return Buffer.from(byteArray.buffer, byteArray.byteOffset, byteArray.byteLength);
				
			}
			// 270: following element is a boxed version of a simple type (e.g. Number, Boolean, String)
			case 270: {
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
			// 141: following string is a shared named symbol
			case 141: {
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
			// 142: following string is a unique unshared symbol
			case 142: {
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

			default: {
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
		}

	}

	/**
	 * https://www.iana.org/assignments/cbor-simple-values/cbor-simple-values.xhtml
	 * @param {number} value
	 * @param {Uint8Array} byteView
	 * @param {object} state
	 * @param {object} options
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
	 * @param {object} state
	 * @param {object} options
	 * @returns {*}
	 */
	function decodeElement(byteView, state, options) {
		let value;
		/*
		if (state.offset === state.end) {
			return nonCodingIndicator;
		}
		*/
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
				state.offset += 1;
				break;
			}
			case 24: {
				if (options.dryRun !== true)
					value = byteView[state.offset + 1];
				state.offset += 2;
				break;
			}
			case 25: {
				if (options.dryRun !== true)
					value = readUint16(byteView, state.offset + 1);
				state.offset += 3;
				break;
			}
			case 26: {
				if (options.dryRun !== true)
					value = readUint32(byteView, state.offset + 1);
				state.offset += 5;
				break;
			}
			case 27: {
				if (options.dryRun !== true)
					value = readUint64(byteView, state.offset + 1);
				state.offset += 9;
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
				state.offset += 1;
				break;
			}
			case 56: {
				if (options.dryRun !== true)
					value = ~byteView[state.offset + 1];
				state.offset += 2;
				break;
			}
			case 57: {
				if (options.dryRun !== true)
					value = ~readUint16(byteView, state.offset + 1);
				state.offset += 3;
				break;
			}
			case 58: {
				if (options.dryRun !== true)
					value = -1 - readUint32(byteView, state.offset + 1);
				state.offset += 5;
				break;
			}
			case 59: {
				if (options.dryRun !== true)
					value = -1 - readUint64(byteView, state.offset + 1);
				state.offset += 9;
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
				const byteLength = -64 + byte;
				value = new Uint8Array(byteView.buffer, state.offset + 1, byteLength);
				state.offset += 1 + byteLength;
				break;
			}
			case 88: {
				const byteLength = byteView[state.offset + 1];
				value = new Uint8Array(byteView.buffer, state.offset + 2, byteLength);
				state.offset += 2 + byteLength;
				break;
			}
			case 89: {
				const byteLength = readUint16(byteView, state.offset + 1);
				value = new Uint8Array(byteView.buffer, state.offset + 3, byteLength);
				state.offset += 3 + byteLength;
				break;
			}
			case 90: {
				const byteLength = readUint32(byteView, state.offset + 1);
				value = new Uint8Array(byteView.buffer, state.offset + 5, byteLength);
				state.offset += 5 + byteLength;
				break;
			}
			case 91: {
				const byteLength = readUint64(byteView, state.offset + 1);
				value = new Uint8Array(byteView.buffer, state.offset + 9, byteLength);
				state.offset += 9 + byteLength;
				break;
			}

			// cases 92 - 94 undefined

			case 95: {
				state.offset += 1;
				const values = [];
				for (; ;) {
					const nextValue = decodeElement(byteView, state, options);
					if (nextValue === breakIndicator) break;
					if (nextValue instanceof NonCodingIndicator) continue;
					if (!(nextValue instanceof Uint8Array))
						throw new Error((typeof nextValue) + " encountered when decoding value of indefinite byte array element.");
					values.push(nextValue);
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
					let byteLength = 0;
					for (let i = 0; i < values.length; ++i)
						byteLength += values[i].byteLength;
					const valueView = new Uint8Array(byteLength);
					value = valueView.buffer;
					let offset = 0;
					for (let i = 0; i < values.length; ++i) {
						const current = values[i];
						const currentLength = current.byteLength;
						valueView.set(current, offset);
						offset += currentLength;
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
				let byteLength = -96 + byte;
				state.offset += 1;
				value = decodeBytesAsUtf8String(byteView, state, byteLength, options);
				break;
			}
			case 120: {
				let byteLength = byteView[state.offset + 1];
				state.offset += 2;
				value = decodeBytesAsUtf8String(byteView, state, byteLength, options);
				break;
			}
			case 121: {
				let byteLength = readUint16(byteView, state.offset + 1);
				state.offset += 3;
				value = decodeBytesAsUtf8String(byteView, state, byteLength, options);
				break;
			}
			case 122: {
				let byteLength = readUint32(byteView, state.offset + 1);
				state.offset += 5;
				value = decodeBytesAsUtf8String(byteView, state, byteLength, options);
				break;
			}
			case 123: {
				let byteLength = readUint64(byteView, state.offset + 1);
				state.offset += 9;
				value = decodeBytesAsUtf8String(byteView, state, byteLength, options);
				break;
			}

			case 127: {
				state.offset += 1;
				const values = [];
				for (; ;) {
					const nextValue = decodeElement(byteView, state, options);
					if (nextValue === breakIndicator) break;
					if (nextValue instanceof NonCodingIndicator) continue;
					if (typeof nextValue !== 'string' && options.indefiniteStringNonStrings !== true)
						throw new Error("Non-string encountered when decoding value of indefinite string element.");
					values.push(nextValue);
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
				const elementCount = -128 + byte;
				state.offset += 1;
				value = parseFixedLengthArray(byteView, state, elementCount, options);
				break;
			}
			case 152: {
				const elementCount = byteView[state.offset + 1];
				state.offset += 2;
				value = parseFixedLengthArray(byteView, state, elementCount, options);
				break;
			}
			case 153: {
				const elementCount = readUint16(byteView, state.offset + 1);
				state.offset += 3;
				value = parseFixedLengthArray(byteView, state, elementCount, options);
				break;
			}
			case 154: {
				const elementCount = readUint32(byteView, state.offset + 1);
				state.offset += 5;
				value = parseFixedLengthArray(byteView, state, elementCount, options);
				break;
			}
			case 155: {
				const elementCount = readUint64(byteView, state.offset + 1);
				state.offset += 9;
				value = parseFixedLengthArray(byteView, state, elementCount, options);
				break;
			}

			case 159: {
				state.offset += 1;
				const addMember = state.next === undefined ? arrayPushMember : setAddMember;
				value = state.next === undefined ? [] : new state.next();
				delete state.next;
				for (; ;) {
					const nextValue = decodeElement(byteView, state, options);
					if (nextValue === breakIndicator) break;
					if (nextValue instanceof NonCodingIndicator) continue;
					addMember(value, nextValue);
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
				let elementCount = -160 + byte;
				state.offset += 1;
				value = parseFixedLengthMap(byteView, state, elementCount, options);
				break;
			}
			case 184: {
				const elementCount = byteView[state.offset + 1];
				state.offset += 2;
				value = parseFixedLengthMap(byteView, state, elementCount, options);
				break;
			}
			case 185: {
				const elementCount = readUint16(byteView, state.offset + 1);
				state.offset += 3;
				value = parseFixedLengthMap(byteView, state, elementCount, options);
				break;
			}
			case 186: {
				const elementCount = readUint32(byteView, state.offset + 1);
				state.offset += 5;
				value = parseFixedLengthMap(byteView, state, elementCount, options);
				break;
			}
			case 187: {
				const elementCount = readUint64(byteView, state.offset + 1);
				state.offset += 9;
				value = parseFixedLengthMap(byteView, state, elementCount, options);
				break;
			}

			case 191: {
				state.offset += 1;
				const setMember = state.next === undefined ? objectSetMember : mapSetMember;
				value = state.next === undefined ? Object.create(null) : new state.next();
				delete state.next;
				for (; ;) {
					const nextKey = decodeElement(byteView, state, options);
					if (nextKey === breakIndicator) break;
					if (nextKey instanceof NonCodingIndicator) continue;
					for (; ;) {
						const nextValue = decodeElement(byteView, state, options);
						if (nextKey === breakIndicator)
							throw new Error("Break indicator encountered when decoding value of indefinite map element.");
						if (nextKey instanceof NonCodingIndicator) continue;
						setMember(value, nextKey, nextValue);
						break;
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
				state.offset += 1;
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

				state.offset += 2;
				if (options.dryRun !== true)
					value = parseTag(byteView[state.offset - 1], byteView, state, options);
				break;
			}
			case 217: {
				state.offset += 3;
				if (options.dryRun !== true)
					value = parseTag(readUint16(byteView, state.offset - 2), byteView, state, options);
				break;
			}
			case 218: {
				state.offset += 5;
				if (options.dryRun !== true)
					value = parseTag(readUint32(byteView, state.offset - 4), byteView, state, options);
				break;
			}
			case 219: {
				state.offset += 9;
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
				state.offset += 1;
				break;
			}
			case 244: {
				value = false;
				state.offset += 1;
				break;
			}
			case 245: {
				value = true;
				state.offset += 1;
				break;
			}
			case 246: {
				value = null;
				state.offset += 1;
				break;
			}
			case 247: {
				value = undefined;
				state.offset += 1;
				break;
			}
			case 248: {
				state.offset += 2;
				if (options.dryRun !== true)
					value = parseSimpleValue(byteView[state.offset - 1], byteView, state, options);
				break;
			}
			case 249: { // fp16
				if (options.dryRun !== true)
					decodeFloat16(readUint16(byteView, state.offset + 1));
				state.offset += 3;
				break;
			}
			case 250: { // fp32
				if (options.dryRun !== true) {
					smallBufferUint32[0] = readUint32(byteView, state.offset + 1);
					value = smallBufferFloat32[0];
				}
				state.offset += 3;
				break;
			}
			case 251: { // fp64
				if (options.dryRun === true) {
					state.offset += 9;
					break;
				}
				state.offset += 1;
				for (let i = 0; i < 8; ++i)
					smallBuffer8Bytes[i] = byteView[state.offset++];
				value = smallBufferFloat64[0];
				break;
			}
			case 255: {
				state.break = true;
				state.offset += 1;
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
	 * @param {object} [options]
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
		let offset = options.offset || 0;
		let length = options.length || buffer.byteLength;
		let byteView = new Uint8Array(buffer);
		let state = Object.setPrototypeOf({offset: offset, end: offset + length}, null);

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
					value.push(decodeElement(byteView, state, options))
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
	initHexCodec();
	initBase64Codec();
	initUtf8Codec();

	// API
	cbor['encode'] = encode;
	cbor['decode'] = decode;

	cbor['decodeElement'] = decodeElement;
	cbor['encodeElement'] = encodeElement;

	cbor['NonCodingIndicator'] = NonCodingIndicator;
	cbor['NonCodingIndicator'] = SelfDescribingIndicator;
	cbor['ErrorIndicator'] = ErrorIndicator;
	cbor['BreakIndicator'] = BreakIndicator;
	cbor['TagIndicator'] = TagIndicator;
	cbor['UnknownSimpleValue'] = UnknownSimpleValue;

	cbor['optionDescriptions'] = optionDescriptions;

	//noinspection JSUnusedAssignment
	cbor['decodeBytesAsUtf8String'] = decodeBytesAsUtf8String;
	//noinspection JSUnusedAssignment
	cbor['decodeBytesAsHexString'] = decodeBytesAsHexString;
	//noinspection JSUnusedAssignment
	cbor['decodeBytesAsBase64String'] = decodeBytesAsBase64String;

	//noinspection JSUnusedAssignment
	cbor['encodeUtf8StringAsBytes'] = encodeUtf8StringAsBytes;
	//noinspection JSUnusedAssignment
	cbor['encodeHexStringAsBytes'] = encodeHexStringAsBytes;
	//noinspection JSUnusedAssignment
	cbor['encodeBase64StringAsBytes'] = encodeBase64StringAsBytes;

	cbor['decodeFloat16'] = decodeFloat16;

	Object.freeze(cbor);

	if (typeof module !== 'undefined' && module.exports) {
		// CommonJS
		module.exports = cbor;
	} else {
		// Global
		root.CBOR = cbor;
	}
})(this);