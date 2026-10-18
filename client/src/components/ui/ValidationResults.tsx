import type { ValidationRuleResult } from '../../../../server/src/utils/validationRules';

export function ValidationResults({ results }: { results?: ValidationRuleResult[] }) {
  if (!results?.length) return null;
  return (
    <ul className="validation-results" aria-label="Validation rule results">
      {results.map((result, index) => (
        <li
          key={`${result.field}:${index}`}
          className={result.status === 'FAILED' ? 'validation-result-failed' : ''}
        >
          <strong>{result.field}</strong>
          <span>
            {result.status === 'PASSED'
              ? 'Passed'
              : result.status === 'SKIPPED'
                ? 'Skipped'
                : 'Failed'}{' '}
            · {result.message}
          </span>
        </li>
      ))}
    </ul>
  );
}
