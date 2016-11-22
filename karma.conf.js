// Karma configuration
// Generated on Sat Oct 29 2016 10:38:55 GMT-0400 (Eastern Daylight Time)

module.exports = function (config) {
	config.set({
		basePath: '',
		frameworks: ['mocha','chai','common_js'],

		files: [
			'cbor.js',
			'test/test.js',
		],

		exclude: [],
		preprocessors: {
			'test/test.js': ['common_js'],
			'cbor.js': ['coverage', 'common_js'],
		},
		reporters: ['progress', 'coverage'],
		port: 9876,
		colors: true,

		// config.LOG_DISABLE || config.LOG_ERROR || config.LOG_WARN || config.LOG_INFO || config.LOG_DEBUG
		logLevel: config.LOG_INFO,

		autoWatch: false,
		browsers: ['Chrome'],
		singleRun: false,
		concurrency: Infinity,

		common_js: {
			transforms: {
			},
			autoRequire: [
				'**/test.js'
			]
		},
	})
};
