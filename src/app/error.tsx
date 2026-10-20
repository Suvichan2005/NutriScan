'use client';
export default function ErrorPage({reset}:{reset:()=>void}){return <main style={{padding:40}}><h1>Something interrupted this scan</h1><p>Your saved scans are still on this device. Try reopening the scanner.</p><button onClick={reset}>Try again</button></main>;}
