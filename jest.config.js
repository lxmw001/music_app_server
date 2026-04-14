module.exports = {
  projects: [
    {
      displayName: 'unit',
      testMatch: ['<rootDir>/src/**/*.spec.ts'],
      transform: { '^.+\\.(t|j)s$': 'ts-jest' },
      moduleFileExtensions: ['js', 'json', 'ts'],
      testEnvironment: 'node',
    },
    {
      displayName: 'integration',
      testMatch: ['<rootDir>/test/**/*.e2e-spec.ts'],
      transform: { '^.+\\.(t|j)s$': 'ts-jest' },
      moduleFileExtensions: ['js', 'json', 'ts'],
      testEnvironment: 'node',
      moduleNameMapper: { '^src/(.*)$': '<rootDir>/src/$1' },
    },
    {
      displayName: 'pbt',
      testMatch: ['<rootDir>/test/**/*.pbt-spec.ts'],
      transform: { '^.+\\.(t|j)s$': 'ts-jest' },
      moduleFileExtensions: ['js', 'json', 'ts'],
      testEnvironment: 'node',
      moduleNameMapper: { '^src/(.*)$': '<rootDir>/src/$1' },
    },
  ],
};
