import { useMemo, useState } from 'react';
import {
  AlertCircle,
  ArrowRight,
  Check,
  Loader2,
  RotateCcw,
  X,
} from 'lucide-react';

const BASIC_EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PHONE_ALLOWED_REGEX = /^[+\d\s().-]{7,25}$/;
const CUSTOM_OPTION_VALUE = '__DATAFIX_CUSTOM__';

function formatDisplayValue(val, emptyLabel = 'Empty') {
  if (val === null || val === undefined || val === '') return emptyLabel;
  if (typeof val === 'object') return 'Repeated row';
  return String(val);
}

function getColumnLabel(colName) {
  if (!colName) return 'Row';
  return colName
    .replaceAll('_', ' ')
    .replace(/\b\w/g, (ch) => ch.toUpperCase());
}

function getStatusPillStyle(displayStatus) {
  switch (displayStatus) {
    case 'Fixed Automatically':
    case 'Fixed Manually':
      return 'df-pill--emerald';
    case 'Needs Your Attention':
      return 'df-pill--amber';
    case 'Rejected':
      return 'df-pill--rose';
    case 'Undone':
      return 'df-pill--violet';
    default:
      return 'df-pill--cyan';
  }
}

/**
 * Resolve the right input control, placeholder, options, and validation rules
 * from the actual dataset column profile and issue metadata.
 */
function resolveInputSpec(item, columnProfile) {
  const colLower = (item.column_name || '').toLowerCase();
  const niceCol = getColumnLabel(item.column_name);
  const inferred = columnProfile?.inferred_type || '';
  const rawOptions =
    columnProfile?.stats?.allowed_values ||
    Object.keys(columnProfile?.stats?.top_values || {});
  const validOptions = rawOptions.filter((v) => String(v).trim() !== '');

  // Email
  if (inferred === 'email' || colLower.includes('email') || colLower.includes('mail')) {
    return {
      control: 'email',
      placeholder: 'Enter email address',
      prefillOriginal: item.issue_type === 'invalid_format' && Boolean(item.before_value),
      validate: (val) =>
        BASIC_EMAIL_REGEX.test(val)
          ? null
          : "That doesn't look like a valid email address (for example: name@example.com).",
    };
  }

  // Phone
  if (
    inferred === 'phone' ||
    colLower.includes('phone') ||
    colLower.includes('mobile') ||
    colLower.includes('tel')
  ) {
    return {
      control: 'tel',
      placeholder: 'Enter phone number',
      prefillOriginal: item.issue_type === 'invalid_format' && Boolean(item.before_value),
      validate: (val) => {
        const digits = val.replace(/\D/g, '');
        if (!PHONE_ALLOWED_REGEX.test(val) || digits.length < 7 || digits.length > 15) {
          return 'Please enter a valid phone number (7 to 15 digits).';
        }
        return null;
      },
    };
  }

  // Date
  if (
    inferred === 'date' ||
    colLower.includes('date') ||
    colLower.includes('dob') ||
    colLower.includes('birth')
  ) {
    return {
      control: 'date',
      placeholder: 'YYYY-MM-DD',
      prefillOriginal: false,
      validate: (val) =>
        Number.isNaN(Date.parse(val))
          ? 'Please pick or enter a valid date.'
          : null,
    };
  }

  // Boolean (Yes / No)
  if (inferred === 'boolean') {
    const usesTrueFalse = validOptions.some((o) =>
      ['true', 'false'].includes(o.toLowerCase())
    );
    return {
      control: 'boolean',
      options: usesTrueFalse
        ? [
            { value: 'True', label: 'Yes (True)' },
            { value: 'False', label: 'No (False)' },
          ]
        : [
            { value: 'Yes', label: 'Yes' },
            { value: 'No', label: 'No' },
          ],
      prefillOriginal: false,
      validate: () => null,
    };
  }

  // Numeric (integer or float / financial amounts)
  if (
    inferred === 'integer' ||
    inferred === 'float' ||
    /amount|price|salary|cost|total|qty|quantity|age|score|balance|revenue/.test(colLower)
  ) {
    const isInt = inferred === 'integer';
    return {
      control: 'number',
      step: isInt ? '1' : 'any',
      placeholder: `Enter ${niceCol.toLowerCase()}`,
      prefillOriginal: false,
      validate: (val) => {
        const cleaned = val.replace(/[$,€£,\s]/g, '');
        const num = Number(cleaned);
        if (cleaned === '' || Number.isNaN(num) || !Number.isFinite(num)) {
          return `Please enter a valid number for ${niceCol.toLowerCase()}.`;
        }
        if (isInt && !Number.isInteger(num)) {
          return `Please enter a whole number for ${niceCol.toLowerCase()}.`;
        }
        return null;
      },
    };
  }

  // Categories / Status / Regions / Locations with known valid options
  if (
    (inferred === 'categorical' ||
      /status|region|country|city|state|location|department|category|tier|plan/.test(colLower)) &&
    validOptions.length > 0 &&
    validOptions.length <= 25
  ) {
    return {
      control: 'select_or_text',
      options: validOptions,
      placeholder: `Enter ${niceCol.toLowerCase()}`,
      prefillOriginal: false,
      validate: () => null,
    };
  }

  // Default: Names and other text fields
  return {
    control: 'text',
    placeholder: `Enter ${niceCol.toLowerCase()}`,
    prefillOriginal: false,
    validate: () => null,
  };
}

function resolveSimpleExplanation(item, spec) {
  const niceCol = getColumnLabel(item.column_name);
  const isNegative =
    item.issue_type === 'statistical_anomaly' &&
    item.before_value !== null &&
    String(item.before_value).trim().startsWith('-');

  if (item.issue_type === 'missing_value') {
    if (spec.control === 'email') {
      return {
        title: 'Email address is missing',
        desc: 'This row does not have an email address. Enter the correct email below or keep it empty.',
      };
    }
    return {
      title: `${niceCol} is missing`,
      desc: `This row is missing a value for ${niceCol.toLowerCase()}. Enter the correct value below or keep it empty.`,
    };
  }

  if (item.issue_type === 'invalid_format' && !item.can_auto_apply) {
    if (spec.control === 'email') {
      return {
        title: "This email address doesn't look valid",
        desc: 'Please check the address and enter the correct email below.',
      };
    }
    if (spec.control === 'date') {
      return {
        title: "We couldn't understand this date",
        desc: "This date doesn't look valid. Please choose or enter the correct date below.",
      };
    }
    if (spec.control === 'tel') {
      return {
        title: "This phone number doesn't look valid",
        desc: 'Please check the number and enter the correct phone number below.',
      };
    }
    return {
      title: `${niceCol} is not in a valid format`,
      desc: `We couldn't fix this ${niceCol.toLowerCase()} automatically. Enter the correct value below or keep the original.`,
    };
  }

  if (isNegative) {
    return {
      title: `Please check this ${niceCol.toLowerCase()}`,
      desc: "This amount is negative. It could be a refund or credit, so we won't change it unless you tell us to.",
    };
  }

  if (item.issue_type === 'statistical_anomaly') {
    return {
      title: `Please check this ${niceCol.toLowerCase()}`,
      desc: 'This number looks unusually high or low compared to the rest of your file. Confirm or enter the correct value below.',
    };
  }

  if (item.repair_action === 'drop_duplicate_row') {
    return {
      title: 'Duplicate entry found',
      desc: 'This row is an exact copy of an earlier row. Removing it keeps your spreadsheet clean.',
    };
  }

  return {
    title: `${niceCol} formatting cleaned`,
    desc: `We standardized the formatting of ${niceCol.toLowerCase()} without changing its meaning.`,
  };
}

export default function ManualCorrectionCard({
  item,
  columnProfile,
  busy = false,
  onSave,
  onKeepOriginal,
  onUndo,
}) {
  const spec = useMemo(
    () => resolveInputSpec(item, columnProfile),
    [item, columnProfile]
  );
  const copy = useMemo(
    () => resolveSimpleExplanation(item, spec),
    [item, spec]
  );

  const initialValue =
    spec.prefillOriginal && item.before_value ? String(item.before_value) : '';
  const [value, setValue] = useState(initialValue);
  const [selectChoice, setSelectChoice] = useState('');
  const [error, setError] = useState(null);

  const canDecide = item.status === 'pending' || item.status === 'undone';
  const needsManualInput =
    !item.can_auto_apply && item.repair_action !== 'drop_duplicate_row';

  const effectiveValue =
    spec.control === 'select_or_text'
      ? selectChoice === CUSTOM_OPTION_VALUE
        ? value
        : selectChoice
      : value;

  const displayStatus =
    item.display_status ||
    (item.status === 'approved'
      ? item.can_auto_apply
        ? 'Fixed Automatically'
        : 'Fixed Manually'
      : item.status === 'rejected'
        ? 'Rejected'
        : item.status === 'undone'
          ? 'Undone'
          : item.safety_category === 'human_review_required'
            ? 'Needs Your Attention'
            : 'Not Fixed Yet');

  const cardStateClass =
    item.status === 'approved'
      ? 'df-repair-card--approved'
      : item.status === 'rejected'
        ? 'df-repair-card--rejected'
        : '';

  const savedOrProposed =
    item.repair_action === 'drop_duplicate_row'
      ? 'Remove repeated row'
      : item.status === 'approved' &&
          item.applied_value !== null &&
          item.applied_value !== undefined
        ? formatDisplayValue(item.applied_value)
        : item.after_value !== null && item.after_value !== undefined
          ? formatDisplayValue(item.after_value)
          : 'Original value kept unchanged';

  const handleSaveClick = () => {
    if (!needsManualInput) {
      onSave(item.repair_id);
      return;
    }
    const trimmed = String(effectiveValue || '').trim();
    if (!trimmed) {
      setError('Please enter or select a value before saving.');
      return;
    }
    const validationErr = spec.validate(trimmed);
    if (validationErr) {
      setError(validationErr);
      return;
    }
    setError(null);
    onSave(item.repair_id, trimmed);
  };

  const inputStyle = {
    width: '100%',
    marginTop: '0.25rem',
    padding: '0.56rem 0.78rem',
    borderRadius: '10px',
    border: error
      ? '1px solid rgba(251, 113, 133, 0.7)'
      : '1px solid rgba(103, 232, 249, 0.3)',
    background: '#08122b',
    color: 'var(--text-primary)',
    fontSize: '0.92rem',
  };

  return (
    <article className={`df-repair-card ${cardStateClass}`}>
      <div className="df-repair-card__head">
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.3rem' }}>
          <div style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: '0.55rem' }}>
            <strong style={{ fontSize: '1rem', color: 'var(--text-primary)' }}>
              {copy.title}
            </strong>
            <span className={`df-pill ${getStatusPillStyle(displayStatus)}`}>
              {displayStatus}
            </span>
          </div>
          <div style={{ fontSize: '0.84rem', color: 'var(--text-muted)' }}>
            Row {item.row_index + 1}
            {item.column_name
              ? ` · ${getColumnLabel(item.column_name)}`
              : ' · Entire Row'}
          </div>
        </div>

        <div className="df-repair-card__actions">
          {canDecide ? (
            <>
              <button
                type="button"
                className="df-action-btn df-action-btn--approve"
                disabled={busy || (needsManualInput && String(effectiveValue || '').trim() === '')}
                onClick={handleSaveClick}
              >
                {busy ? (
                  <Loader2 size={14} style={{ animation: 'spin 1s linear infinite' }} />
                ) : (
                  <Check size={14} />
                )}
                <span>{needsManualInput ? 'Save Correction' : 'Fix This'}</span>
              </button>
              <button
                type="button"
                className="df-action-btn df-action-btn--reject"
                disabled={busy}
                onClick={() => onKeepOriginal(item.repair_id)}
              >
                <X size={14} />
                <span>Keep Original Value</span>
              </button>
            </>
          ) : (
            <button
              type="button"
              className="df-action-btn"
              disabled={busy}
              onClick={() => onUndo(item.repair_id)}
            >
              {busy ? (
                <Loader2 size={14} style={{ animation: 'spin 1s linear infinite' }} />
              ) : (
                <RotateCcw size={14} />
              )}
              <span>Undo</span>
            </button>
          )}
        </div>
      </div>

      <p style={{ color: 'var(--text-secondary)', fontSize: '0.9rem', lineHeight: 1.55 }}>
        {copy.desc}
      </p>

      <div className="df-diff-row">
        <div className="df-diff-card df-diff-card--before">
          <div className="df-diff-card__tag">
            <span>Original Value</span>
          </div>
          <div className="df-diff-card__value">
            {formatDisplayValue(item.before_value)}
          </div>
        </div>

        <div className="df-diff-arrow" aria-hidden="true">
          <ArrowRight size={18} />
        </div>

        <div className="df-diff-card df-diff-card--after">
          <div className="df-diff-card__tag">
            <span>
              {item.status === 'approved'
                ? 'Saved Value'
                : needsManualInput
                  ? 'Enter the Correct Value'
                  : 'After Cleaning'}
            </span>
          </div>

          {canDecide && needsManualInput ? (
            <div>
              {spec.control === 'boolean' ? (
                <select
                  value={value}
                  onChange={(e) => {
                    setValue(e.target.value);
                    setError(null);
                  }}
                  aria-label={`Select value for ${item.column_name}`}
                  style={inputStyle}
                >
                  <option value="">Choose Yes or No...</option>
                  {spec.options.map((opt) => (
                    <option key={opt.value} value={opt.value}>
                      {opt.label}
                    </option>
                  ))}
                </select>
              ) : spec.control === 'select_or_text' ? (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.45rem' }}>
                  <select
                    value={selectChoice}
                    onChange={(e) => {
                      setSelectChoice(e.target.value);
                      setError(null);
                    }}
                    aria-label={`Select ${item.column_name}`}
                    style={inputStyle}
                  >
                    <option value="">Choose an option...</option>
                    {spec.options.map((opt) => (
                      <option key={opt} value={opt}>
                        {opt}
                      </option>
                    ))}
                    <option value={CUSTOM_OPTION_VALUE}>Type a different value...</option>
                  </select>
                  {selectChoice === CUSTOM_OPTION_VALUE && (
                    <input
                      type="text"
                      value={value}
                      onChange={(e) => {
                        setValue(e.target.value);
                        setError(null);
                      }}
                      placeholder={spec.placeholder}
                      aria-label={`Custom value for ${item.column_name}`}
                      style={inputStyle}
                    />
                  )}
                </div>
              ) : (
                <input
                  type={spec.control}
                  step={spec.step}
                  value={value}
                  onChange={(e) => {
                    setValue(e.target.value);
                    setError(null);
                  }}
                  placeholder={spec.placeholder}
                  aria-label={`${copy.title} for row ${item.row_index + 1}`}
                  style={inputStyle}
                />
              )}

              {error && (
                <div
                  role="alert"
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '0.4rem',
                    marginTop: '0.4rem',
                    fontSize: '0.82rem',
                    color: '#fda4af',
                  }}
                >
                  <AlertCircle size={14} style={{ flexShrink: 0 }} />
                  <span>{error}</span>
                </div>
              )}
            </div>
          ) : (
            <div className="df-diff-card__value">{savedOrProposed}</div>
          )}
        </div>
      </div>
    </article>
  );
}
