import type { Metadata, Viewport } from "next";
import { Fraunces, Geist, Geist_Mono } from "next/font/google";
import { SITE_URL } from "@/lib/siteUrl";
import "./globals.css";

const geistSans = Geist({ variable: "--font-geist-sans", subsets: ["latin"] });
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });
const fraunces = Fraunces({
  variable: "--font-fraunces",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  style: ["normal", "italic"],
});

const TITLE = "CoinLens — snap a coin, get an eBay-ready listing";
const DESCRIPTION =
  "Photograph both sides of any coin and CoinLens finds it, crops it, identifies the date, mint and variety, estimates the grade and value, and writes your eBay title, description and item specifics in about a minute.";

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: { default: TITLE, template: "%s · CoinLens" },
  description: DESCRIPTION,
  applicationName: "CoinLens",
  keywords: [
    "coin identifier",
    "coin scanner app",
    "identify coin from photo",
    "coin grading app",
    "sell coins on eBay",
    "eBay coin listing generator",
    "coin value estimator",
    "numismatics",
  ],
  alternates: { canonical: "/" },
  openGraph: {
    type: "website",
    url: "/",
    siteName: "CoinLens",
    title: TITLE,
    description: DESCRIPTION,
    locale: "en_US",
  },
  twitter: {
    card: "summary_large_image",
    title: TITLE,
    description: DESCRIPTION,
  },
  robots: { index: true, follow: true },
  manifest: "/manifest.webmanifest",
  appleWebApp: { capable: true, title: "CoinLens", statusBarStyle: "black-translucent" },
  category: "shopping",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#0a0e18",
};

/**
 * Runs before any bundle loads: reports that the HTML reached the device and
 * catches script errors that happen before React is up. Lets us see phones
 * that load the page but never run the app.
 */
const BOOT_SCRIPT = `
(function(){
  function send(level, msg, data){
    try {
      var body = JSON.stringify({events:[{t:Date.now(),level:level,step:"boot",msg:msg,data:data}]});
      if (navigator.sendBeacon) navigator.sendBeacon("/api/log", new Blob([body], {type:"application/json"}));
      else fetch("/api/log",{method:"POST",headers:{"Content-Type":"application/json"},body:body,keepalive:true});
    } catch (e) {}
  }
  send("info","HTML loaded",{url:location.href,ua:navigator.userAgent,screen:screen.width+"x"+screen.height});
  // A service worker or cache left behind by another app on this host:port can serve stale
  // scripts and stop the app from starting. Clear them once and reload.
  try {
    if (navigator.serviceWorker && navigator.serviceWorker.getRegistrations) {
      navigator.serviceWorker.getRegistrations().then(function(regs){
        if (!regs.length) return;
        send("warn","Found "+regs.length+" stale service worker(s); unregistering",{scopes:regs.map(function(r){return r.scope;})});
        Promise.all(regs.map(function(r){return r.unregister();})).then(function(){
          var p = window.caches ? caches.keys().then(function(ks){return Promise.all(ks.map(function(k){return caches.delete(k);}));}) : Promise.resolve();
          p.then(function(){
            if (!sessionStorage.getItem("cl-sw-reload")) { sessionStorage.setItem("cl-sw-reload","1"); location.reload(); }
          });
        });
      });
    }
  } catch (e) {}
  window.addEventListener("error",function(e){
    send("error",e.message||"Script error",{file:e.filename,line:e.lineno,col:e.colno});
  });
  window.addEventListener("unhandledrejection",function(e){
    var r=e.reason; send("error","Unhandled rejection (early)",{reason:r&&r.message?r.message:String(r)});
  });
})();`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} ${fraunces.variable} h-full antialiased`}
    >
      <head>
        <script dangerouslySetInnerHTML={{ __html: BOOT_SCRIPT }} />
      </head>
      <body className="flex min-h-full flex-col">{children}</body>
    </html>
  );
}
