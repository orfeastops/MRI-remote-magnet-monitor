import { useEffect, useRef } from 'react';
import { Terminal } from 'xterm';
import { FitAddon } from '@xterm/addon-fit';
import 'xterm/css/xterm.css';
import styles from './TerminalTab.module.css';

export default function TerminalTab({ rawData }) {
  const containerRef = useRef(null);
  const termRef      = useRef(null);
  const fitRef       = useRef(null);

  // Init terminal once
  useEffect(() => {
    const term = new Terminal({
      theme: {
        background: '#0a0e17',
        foreground: '#e2e8f0',
        cursor:     '#38bdf8',
        black:      '#0a0e17',
        brightBlack:'#475569',
      },
      fontFamily: '"Cascadia Code", "Fira Code", "Courier New", monospace',
      fontSize: 13,
      cursorBlink: true,
      scrollback: 2000,
      convertEol: false,
    });
    const fit = new FitAddon();
    term.loadAddon(fit);
    term.open(containerRef.current);
    fit.fit();
    termRef.current = term;
    fitRef.current  = fit;

    const ro = new ResizeObserver(() => fit.fit());
    ro.observe(containerRef.current);

    return () => {
      ro.disconnect();
      term.dispose();
    };
  }, []);

  // Write incoming VT100 data
  useEffect(() => {
    if (rawData && termRef.current) {
      termRef.current.write(rawData);
    }
  }, [rawData]);

  return <div ref={containerRef} className={styles.term} />;
}
