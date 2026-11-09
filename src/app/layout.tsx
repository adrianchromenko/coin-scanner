import type { Metadata, Viewport } from "next";
import { Geist_Mono, Poppins } from "next/font/google";
import AuthProvider from "@/components/AuthProvider";
import InstallPrompt from "@/components/InstallPrompt";
import ServiceWorkerRegistration from "@/components/ServiceWorkerRegistration";
import { SITE_URL } from "@/lib/siteUrl";
import "./globals.css";

// One brand face: Poppins, the typeface of the drawn wordmark. Geist Mono stays for ledger labels and numbers.
const poppins = Poppins({
  variable: "--font-poppins",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700", "800"],
});
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });

const TITLE = "CoinLens — know what you're holding";
const DESCRIPTION =
  "Snap both sides of any coin. CoinLens finds it, identifies the date, mint and variety, grades it, checks what the same coin sold for, and writes a ready-to-post eBay listing in about a minute.";

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
  themeColor: "#0c0a08",
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
  // scripts and stop the app from starting. Clear foreign ones once and reload; leave our own
  // worker (/sw.js at the root scope) and its "coinlens-*" caches alone.
  try {
    if (navigator.serviceWorker && navigator.serviceWorker.getRegistrations) {
      navigator.serviceWorker.getRegistrations().then(function(regs){
        function ours(r){
          var w = r.active || r.waiting || r.installing;
          var url = (w && w.scriptURL) || "";
          return r.scope.slice(-1) === "/" && url.slice(-6) === "/sw.js";
        }
        var stale = regs.filter(function(r){ return !ours(r); });
        if (!stale.length) return;
        send("warn","Found "+stale.length+" stale service worker(s); unregistering",{scopes:stale.map(function(r){return r.scope;})});
        Promise.all(stale.map(function(r){return r.unregister();})).then(function(){
          var p = window.caches
            ? caches.keys().then(function(ks){
                return Promise.all(ks.filter(function(k){return k.indexOf("coinlens-")!==0;}).map(function(k){return caches.delete(k);}));
              })
            : Promise.resolve();
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
      className={`${poppins.variable} ${geistMono.variable} h-full antialiased`}
    >
      <head>
        <script dangerouslySetInnerHTML={{ __html: BOOT_SCRIPT }} />
      </head>
      <body className="flex min-h-full flex-col">
        <ServiceWorkerRegistration />
        <InstallPrompt />
        <AuthProvider>{children}</AuthProvider>
      </body>
    </html>
  );
}
