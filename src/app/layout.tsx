import type { Metadata } from 'next';
import './globals.css';
export const metadata:Metadata={title:'NutriScan · Understand your food',description:'Read a package. Understand the evidence. Make a more informed choice.',robots:{index:false,follow:false}};
export default function RootLayout({children}:Readonly<{children:React.ReactNode}>){return <html lang="en"><body>{children}</body></html>;}
