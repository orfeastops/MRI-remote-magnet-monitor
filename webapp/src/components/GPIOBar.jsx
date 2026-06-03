import styles from './GPIOBar.module.css';

// pins = { 32: 0|1, 34: 0|1, 35: 0|1 }
// For GPIO32 (INPUT_PULLUP): LOW = active alarm → state===0 means alarm
// For GPIO34/35 (INPUT, no pullup): HIGH = active → state===1 means alarm
function isAlarm32(state) { return state === 0; }
function isAlarm34(state) { return state === 1; }
function isAlarm35(state) { return state === 1; }

export default function GPIOBar({ pins = {} }) {
  const a1 = pins[32] ?? pins['32'];
  const a2 = pins[34] ?? pins['34'];
  const q  = pins[35] ?? pins['35'];

  const alarm1  = a1 !== undefined && isAlarm32(a1);
  const alarm2  = a2 !== undefined && isAlarm34(a2);
  const quench  = q  !== undefined && isAlarm35(q);

  const pin = (label, active, isCritical) => (
    <div className={`${styles.pin} ${active ? (isCritical ? styles.critical : styles.alarm) : styles.normal}`}>
      <span className={styles.dot}>●</span>
      <span className={styles.label}>{label}</span>
      <span className={styles.status}>{active ? (isCritical ? 'QUENCH' : 'ALARM') : 'NORMAL'}</span>
    </div>
  );

  return (
    <div className={styles.bar}>
      {pin('PIN1', alarm1, false)}
      {pin('PIN2', alarm2, false)}
      {pin('QUENCH', quench, true)}
    </div>
  );
}
