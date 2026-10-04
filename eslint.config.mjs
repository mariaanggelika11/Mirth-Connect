import tseslint from 'typescript-eslint';
export default tseslint.config({ignores:['**/node_modules/**','**/dist/**','server/public/**']},...tseslint.configs.recommended,{files:['**/*.ts','**/*.tsx'],rules:{'@typescript-eslint/no-explicit-any':'error','@typescript-eslint/no-unused-vars':['error',{argsIgnorePattern:'^_',varsIgnorePattern:'^_'}],'@typescript-eslint/no-namespace':'off'}});
