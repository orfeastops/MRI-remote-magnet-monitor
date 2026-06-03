import styles from './DashboardTab.module.css';

// Parse VT100 cursor-position sequences: ESC[row;colH followed by text
function parseVT100Screen(raw) {
  const screen = {};
  const re = /(?:\x1b)?\[(\d+);(\d+)H([^\[\x1b]*)/g;
  let m;
  while ((m = re.exec(raw)) !== null) {
    const val = m[3].replace(/\x1b?\[\d*[a-zA-Z]/g, '').trim();
    if (val) screen[`${m[1]}:${m[2]}`] = val;
  }
  return screen;
}

const FIELDS = [
  { label: 'He Level 1',    pos: '7:41',  unit: '%'  },
  { label: 'He Level 2',    pos: '7:48',  unit: '%'  },
  { label: 'He Status',     pos: '8:6'               },
  { label: 'Field Current', pos: 'fc'                },
  { label: 'Self Test',     pos: '9:37'              },
  { label: 'Battery',       pos: '10:11'             },
  { label: 'Volts',         pos: '11:11', unit: 'V'  },
  { label: 'Compressor',    pos: '10:37'             },
  { label: 'Press HTR',     pos: '11:41'             },
  { label: 'Cold Head',     pos: '13:20', unit: '°K' },
  { label: 'Shield S1',     pos: '14:20', unit: '°K' },
  { label: 'Shield S2',     pos: '14:36', unit: '°K' },
  { label: 'Turret S1',     pos: '15:20', unit: '°K' },
  { label: 'Turret S2',     pos: '15:36', unit: '°K' },
  { label: 'Mag psiA',      pos: '20:20', unit: 'psi'},
  { label: 'Avg Power',     pos: '21:20', unit: 'W'  },
  { label: 'ERDU',          pos: 'erdu'              },
];

function classify(label, val) {
  if (!val) return 'unknown';
  const v = val.toUpperCase();
  if (v.includes('ALARM') || v.includes('FAULT') || v === 'FAIL') return 'alarm';
  if (v === 'OFF' || v.includes('WARN') || v === 'LOW' || v === '00.00') return 'warn';
  return 'ok';
}

export default function DashboardTab({ rawBuffer }) {
  if (!rawBuffer) {
    return <div className={styles.empty}>Waiting for MRI data…</div>;
  }

  const screen = parseVT100Screen(rawBuffer);

  // Field current extracted from row 3:16 text
  const fcRaw = screen['3:16'] || '';
  const fcMatch = fcRaw.match(/([\d.]+\s*A)/);
  const fcVal = fcMatch ? fcMatch[1] : '';

  // ERDU
  const erduRaw = screen['22:21'] || '';
  const erduVal = (erduRaw.match(/([\d.]+)/) || [])[1] || '';

  const resolved = FIELDS.map(f => {
    let val = '';
    if (f.pos === 'fc')   val = fcVal;
    else if (f.pos === 'erdu') val = erduVal;
    else val = screen[f.pos] || '';
    return { ...f, val };
  }).filter(f => f.val);

  // Faults
  const faults = [];
  if (rawBuffer.includes('LOAD ALARM'))            faults.push('Battery: Load Alarm');
  if (rawBuffer.includes('TOO FEW BUTTONS'))       faults.push('ERDU: Too Few Buttons');
  if (rawBuffer.includes('Alarmbox Communications Fault')) faults.push('Alarmbox Comms Fault');
  const comp = screen['10:37'] || '';
  if (comp.toUpperCase() === 'OFF') faults.push('Compressor is OFF');

  if (resolved.length === 0) {
    return <div className={styles.empty}>Parsing MRI data…</div>;
  }

  return (
    <div className={styles.wrap}>
      {faults.length > 0 && (
        <div className={styles.faults}>
          {faults.map(f => <div key={f} className={styles.fault}>⚠ {f}</div>)}
        </div>
      )}
      <div className={styles.grid}>
        {resolved.map(f => {
          const cls = classify(f.label, f.val);
          return (
            <div key={f.label} className={`${styles.card} ${styles[cls]}`}>
              <div className={styles.cardLabel}>{f.label}</div>
              <div className={styles.cardValue}>
                {f.val}
                {f.unit && f.val && <span className={styles.unit}> {f.unit}</span>}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
