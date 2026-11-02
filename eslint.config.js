'use strict';

var js = require('@eslint/js');

module.exports = [
	{
		ignores: ['test/fixtures/**']
	},
	js.configs.recommended,
	{
		languageOptions: {
			ecmaVersion: 'latest',
			sourceType: 'commonjs',
			globals: {
				process: 'readonly',
				setTimeout: 'readonly',
				__dirname: 'readonly',
				global: 'readonly'
			}
		},
		rules: {
			'quotes': ['error', 'single'],
			'no-use-before-define': ['error', 'nofunc'],
			'no-unused-vars': ['error', {
				'vars': 'all',
				'args': 'none',
				'caughtErrors': 'none'
			}],
			'no-console': 'error'
		}
	},
	{
		files: ['test/**'],
		rules: {
			'no-unused-expressions': 'off'
		}
	}
];
