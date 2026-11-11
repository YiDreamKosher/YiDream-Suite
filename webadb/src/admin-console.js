import { mountApplicationForm, applicationReviewMarkup } from './application-form.js';
import './application-form.css';
import * as cloud from './cloud-admin.js';
import { renderAndroidWizard, disposeAndroidWizard, disconnectAndroidWorkspace, knownAppPackages } from './ui-android.js';
import { mountDeviceControls } from './device-controls.js';
import { deviceCopy } from './device-control-copy.js';
import './device-controls.css';
import './admin-simple.css';
import { runGate } from './gate.js';
import logoUrl from '../assets/yidream-logo.png';
import adminLogoUrl from '../assets/icons/yidream-admin.png';
import { MDM_TITLES, mdmFrameSource, mdmViewFromHash, mdmPage, mdmViewForPage, trustedMdmMessage } from './mdm-shell.js';
import './mdm-shell.css';
const $=(s,r=document)=>r.querySelector(s), esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const app=$('#app');
const adminLanguage=localStorage.getItem('yidream-admin-language')||'en';
window.getLang=()=>adminLanguage;
window.getAndroidUnlockMaterial=()=>cloud.getAndroidUnlockMaterial();
const adminTranslations={
en:{
'Retour à la présentation':'Back to overview','Demander un accès administrateur':'Request administrator access','Connexion administrateur':'Administrator sign in','Connectez-vous pour gérer les appareils et les comptes autorisés.':'Sign in to manage devices and authorized accounts.','Nom de la boutique ou organisation':'Shop or organization name','Adresse e-mail':'Email address','Mot de passe':'Password','Confirmer le mot de passe':'Confirm password','Créer mon compte':'Create account','Se connecter':'Sign in','Continuer avec Google':'Continue with Google','Vous souhaitez gérer YiDream ?':'Would you like to manage YiDream?','Demander un accès':'Request access','Postuler comme administrateur':'Apply to become an administrator','PORTAIL ADMINISTRATEUR':'ADMINISTRATOR PORTAL','Gérez les appareils YiDream dans un espace sécurisé.':'Manage YiDream devices in a secure workspace.','Accéder à la console':'Open the console','Déposer une candidature':'Submit an application','Comment rejoindre l’espace ?':'How to join the workspace?','Votre candidature administrateur':'Your administrator application','Envoyer ma candidature':'Submit my application','Candidature enregistrée':'Application received','Espace de gestion':'Workspace','Vue d’ensemble':'Overview','Appareils':'Devices','Clients':'Clients','Journal d’activité':'Activity log','Plateformes':'Platforms','Déjà dispo':'Available','Bientôt dispo':'Coming soon','Appareils Android':'Android devices','Ouvrir YiDream Suite':'Open YiDream Suite','ESPACE ADMINISTRATEUR':'ADMINISTRATOR WORKSPACE','COMPTE REVENDEUR':'RESELLER ACCOUNT','Se déconnecter':'Sign out','Candidatures':'Applications','Administrateurs':'Administrators','Magasins':'Stores','Demandes récentes':'Recent requests','Toutes les candidatures →':'All applications →','Approuver':'Approve','Refuser':'Reject','Aucune candidature.':'No applications.','Comptes administrateur':'Administrator accounts','Magasins et organisations':'Stores and organizations','Appareils à configurer':'Devices to configure','Appareils inscrits':'Enrolled devices','Clients':'Clients','Enregistrer':'Save','Annuler':'Cancel','Réessayer':'Retry','Chargement de votre espace revendeur…':'Loading your reseller workspace…','Inscrire un appareil':'Enroll a device','Aucun appareil inscrit pour le moment.':'No devices enrolled yet.'},
he:{
'Retour à la présentation':'חזרה לסקירה','Demander un accès administrateur':'בקשת גישת מנהל','Connexion administrateur':'כניסת מנהל','Connectez-vous pour gérer les appareils et les comptes autorisés.':'התחברו כדי לנהל מכשירים וחשבונות מורשים.','Nom de la boutique ou organisation':'שם החנות או הארגון','Adresse e-mail':'כתובת דוא״ל','Mot de passe':'סיסמה','Confirmer le mot de passe':'אימות סיסמה','Créer mon compte':'יצירת חשבון','Se connecter':'התחברות','Continuer avec Google':'המשך עם Google','Vous souhaitez gérer YiDream ?':'רוצים לנהל את YiDream?','Demander un accès':'בקשת גישה','Postuler comme administrateur':'הגשת מועמדות למנהל','PORTAIL ADMINISTRATEUR':'פורטל מנהלים','Gérez les appareils YiDream dans un espace sécurisé.':'נהלו את מכשירי YiDream בסביבה מאובטחת.','Accéder à la console':'כניסה למסוף','Déposer une candidature':'הגשת מועמדות','Comment rejoindre l’espace ?':'איך מצטרפים למערכת?','Votre candidature administrateur':'המועמדות שלכם לניהול','Envoyer ma candidature':'שליחת המועמדות','Candidature enregistrée':'המועמדות נשמרה','Espace de gestion':'סביבת ניהול','Vue d’ensemble':'סקירה כללית','Appareils':'מכשירים','Clients':'לקוחות','Journal d’activité':'יומן פעילות','Plateformes':'פלטפורמות','Déjà dispo':'זמין','Bientôt dispo':'בקרוב','Appareils Android':'מכשירי Android','Ouvrir YiDream Suite':'פתיחת YiDream Suite','ESPACE ADMINISTRATEUR':'סביבת מנהל','COMPTE REVENDEUR':'חשבון משווק','Se déconnecter':'התנתקות','Candidatures':'מועמדויות','Administrateurs':'מנהלים','Magasins':'חנויות','Demandes récentes':'בקשות אחרונות','Toutes les candidatures →':'כל המועמדויות →','Approuver':'אישור','Refuser':'דחייה','Aucune candidature.':'אין מועמדויות.','Comptes administrateur':'חשבונות מנהל','Magasins et organisations':'חנויות וארגונים','Appareils à configurer':'מכשירים להגדרה','Appareils inscrits':'מכשירים רשומים','Enregistrer':'שמירה','Annuler':'ביטול','Réessayer':'ניסיון חוזר','Chargement de votre espace revendeur…':'טוען את סביבת המשווק…','Inscrire un appareil':'רישום מכשיר','Aucun appareil inscrit pour le moment.':'אין מכשירים רשומים כרגע.'},
yi:{
'Retour à la présentation':'צוריק צום איבערבליק','Demander un accès administrateur':'בעטן אַדמיניסטראַטאָר צוטריט','Connexion administrateur':'אַדמיניסטראַטאָר אַרײַנלאָגירן','Connectez-vous pour gérer les appareils et les comptes autorisés.':'אַרײַנלאָגירן צו פירן דיווייסעס און דערלויבטע חשבונות.','Nom de la boutique ou organisation':'נאָמען פֿון קראָם אָדער אָרגאַניזאַציע','Adresse e-mail':'אימייל אַדרעס','Mot de passe':'פּאַראָל','Confirmer le mot de passe':'באַשטעטיקן פּאַראָל','Créer mon compte':'שאַפֿן חשבון','Se connecter':'אַרײַנלאָגירן','Continuer avec Google':'פֿאָרזעצן מיט Google','Vous souhaitez gérer YiDream ?':'ווילט איר פירן YiDream?','Demander un accès':'בעטן צוטריט','Postuler comme administrateur':'זיך אָנווענדן ווי אַדמיניסטראַטאָר','PORTAIL ADMINISTRATEUR':'אַדמיניסטראַטאָר פּאָרטאַל','Gérez les appareils YiDream dans un espace sécurisé.':'פירט YiDream דיווייסעס אין אַ זיכערער סביבה.','Accéder à la console':'עפֿענען די קאָנסאָל','Déposer une candidature':'אַרײַנגעבן אַ בקשה','Comment rejoindre l’espace ?':'ווי קומט מען אַרײַן?','Votre candidature administrateur':'אייער אַדמיניסטראַטאָר בקשה','Envoyer ma candidature':'שיקן מיין בקשה','Candidature enregistrée':'בקשה אויפֿגעהיט','Espace de gestion':'פאַרוואַלטונג','Vue d’ensemble':'איבערבליק','Appareils':'דיווייסעס','Clients':'קליענטן','Journal d’activité':'אַקטיוויטעט לאָג','Plateformes':'פּלאַטפֿאָרמעס','Déjà dispo':'פֿאַראַן','Bientôt dispo':'באַלד בנימצא','Appareils Android':'Android דיווייסעס','Ouvrir YiDream Suite':'עפֿענען YiDream Suite','ESPACE ADMINISTRATEUR':'אַדמיניסטראַטאָר פּלאַץ','COMPTE REVENDEUR':'ריסעלער חשבון','Se déconnecter':'אַרויסלאָגירן','Candidatures':'בקשות','Administrateurs':'אַדמיניסטראַטאָרן','Magasins':'געשעפֿטן','Demandes récentes':'נײַע בקשות','Toutes les candidatures →':'אַלע בקשות →','Approuver':'באַשטעטיקן','Refuser':'אָפּזאָגן','Aucune candidature.':'קיין בקשות.','Comptes administrateur':'אַדמיניסטראַטאָר חשבונות','Magasins et organisations':'געשעפֿטן און אָרגאַניזאַציעס','Appareils à configurer':'דיווייסעס צו קאַנפֿיגורירן','Appareils inscrits':'רעגיסטרירטע דיווייסעס','Enregistrer':'אויפֿהיטן','Annuler':'אַנולירן','Réessayer':'פּרובירן ווידער','Chargement de votre espace revendeur…':'לאָדן אייער ריסעלער פּלאַץ…','Inscrire un appareil':'רעגיסטרירן אַ דיווייס','Aucun appareil inscrit pour le moment.':'קיין דיווייסעס רעגיסטרירט דערווײַל.'}
};
adminTranslations.en["Paramètres du compte"]="Account settings";adminTranslations.he["Paramètres du compte"]="הגדרות חשבון";adminTranslations.yi["Paramètres du compte"]="סעטינגס פֿון חשבון";
adminTranslations.en["Paramètres du compte"]="Account settings";adminTranslations.he["Paramètres du compte"]="הגדרות חשבון";adminTranslations.yi["Paramètres du compte"]="סעטינגס פֿון חשבון";
adminTranslations.en["Modifiez les informations de votre compte revendeur."]="Edit your reseller account information.";adminTranslations.he["Modifiez les informations de votre compte revendeur."]="עדכנו את פרטי חשבון המשווק שלכם.";adminTranslations.yi["Modifiez les informations de votre compte revendeur."]="ענדערט אייער ריסעלער חשבון אינפֿאָרמאַציע.";
adminTranslations.en["Langue de l’espace administrateur"]="Admin workspace language";adminTranslations.he["Langue de l’espace administrateur"]="שפת סביבת המנהל";adminTranslations.yi["Langue de l’espace administrateur"]="שפּראַך פֿון אַדמיניסטראַטאָר פּלאַץ.";
adminTranslations.en["Profil revendeur mis à jour."]="Reseller profile updated.";adminTranslations.he["Profil revendeur mis à jour."]="פרופיל המשווק עודכן.";adminTranslations.yi["Profil revendeur mis à jour."]="ריסעלער פּראָפֿיל דערהײַנטיקט.";
adminTranslations.en["Saisissez un nom pour la boutique."]="Enter a shop name.";adminTranslations.he["Saisissez un nom pour la boutique."]="יש להזין שם לחנות.";adminTranslations.yi["Saisissez un nom pour la boutique."]="שרייבט אַרײַן אַ נאָמען פֿאַרן קראָם.";adminTranslations.en["Applications YiDream"]="YiDream apps";adminTranslations.he["Applications YiDream"]="יישומי YiDream";adminTranslations.yi["Applications YiDream"]="YiDream אַפּס";adminTranslations.en["Bientôt"]="Soon";adminTranslations.he["Bientôt"]="בקרוב";adminTranslations.yi["Bientôt"]="באַלד";adminTranslations.en["Code de déverrouillage"]="Unlock code";adminTranslations.he["Code de déverrouillage"]="קוד פתיחה";adminTranslations.yi["Code de déverrouillage"]="קאָד צו עפֿענען";adminTranslations.en["Réservé aux administrateurs approuvés. Le code change chaque jour."]="For approved administrators. The code changes daily.";adminTranslations.he["Réservé aux administrateurs approuvés. Le code change chaque jour."]="למנהלים שאושרו. הקוד מתחלף מדי יום.";adminTranslations.yi["Réservé aux administrateurs approuvés. Le code change chaque jour."]="פֿאַר באַשטעטיקטע אַדמיניסטראַטאָרן. דער קאָד ענדערט זיך יעדן טאָג.";adminTranslations.en["Valable aujourd’hui · renouvelé automatiquement demain"]="Valid today · renews automatically tomorrow";adminTranslations.he["Valable aujourd’hui · renouvelé automatiquement demain"]="תקף להיום · מתחדש אוטומטית מחר";adminTranslations.yi["Valable aujourd’hui · renouvelé automatiquement demain"]="גילטיק הײַנט · ווערט אויטאָמאַטיש באנייט מאָרגן";adminTranslations.en["Appliquer la configuration"]="Apply configuration";adminTranslations.he["Appliquer la configuration"]="החלת ההגדרות";adminTranslations.yi["Appliquer la configuration"]="אָנווענדן קאַנפֿיגוראַציע";adminTranslations.en["Le code sécurisé est ajouté au téléphone pendant cette étape."]="The secure key is sent to the phone during this step.";adminTranslations.he["Le code sécurisé est ajouté au téléphone pendant cette étape."]="המפתח המאובטח נשלח לטלפון בשלב זה.";adminTranslations.yi["Le code sécurisé est ajouté au téléphone pendant cette étape."]="דער זיכערער שליסל ווערט געשיקט צום טעלעפֿאָן אין דעם שריט.";

const mdmNavigationTranslations={
 en:{'Accueil':'Home','Boutique d’applications':'App store','Demandes de sites':'Website requests','Associer un appareil':'Pair a device','Suivi de votre espace':'Workspace overview'},
 he:{'Accueil':'בית','Boutique d’applications':'חנות יישומים','Demandes de sites':'בקשות אתרים','Associer un appareil':'שיוך מכשיר','Suivi de votre espace':'סקירת סביבת הניהול'},
 yi:{'Accueil':'היים','Boutique d’applications':'אַפּ קראָם','Demandes de sites':'וועבזײַט בקשות','Associer un appareil':'צופּאָרן אַ דיווייס','Suivi de votre espace':'איבערבליק פֿון אייער פּלאַץ'}
};
for(const language of ['en','he','yi'])Object.assign(adminTranslations[language],mdmNavigationTranslations[language]);

const ownerAccessTranslations={
 en:{'État d’accès':'Access status','Actif':'Active','Suspendu':'Suspended','Protégé':'Protected','Suspendre l’accès':'Suspend access','Rétablir l’accès':'Restore access','Suspendre bloque immédiatement les opérations protégées. Le compte reste dans la liste et peut être réactivé ici.':'Suspending immediately blocks protected operations. The account stays listed and can be restored here.','Accès administrateur suspendu':'Administrator access suspended','Le propriétaire YiDream a suspendu ce compte. Les données et appareils restent conservés, mais les actions administrateur sont bloquées. Contacte le propriétaire pour demander le rétablissement de l’accès.':'The YiDream owner suspended this account. Its data and devices are preserved, but administrator actions are blocked. Contact the owner to request restored access.'},
 he:{'État d’accès':'מצב גישה','Actif':'פעיל','Suspendu':'מושהה','Protégé':'מוגן','Suspendre l’accès':'השהיית הגישה','Rétablir l’accès':'שחזור הגישה','Suspendre bloque immédiatement les opérations protégées. Le compte reste dans la liste et peut être réactivé ici.':'השהיה חוסמת מיד פעולות מוגנות. החשבון נשאר ברשימה וניתן להפעיל אותו מחדש כאן.','Accès administrateur suspendu':'גישת מנהל הושהתה','Le propriétaire YiDream a suspendu ce compte. Les données et appareils restent conservés, mais les actions administrateur sont bloquées. Contacte le propriétaire pour demander le rétablissement de l’accès.':'בעלים YiDream השהה את החשבון. הנתונים והמכשירים נשמרים, אך פעולות המנהל חסומות. פנו לבעלים לבקשת שחזור גישה.'},
 yi:{'État d’accès':'צושטאַנד פֿון צוטריט','Actif':'אַקטיוו','Suspendu':'אָפּגעהאַלטן','Protégé':'באַשיצט','Suspendre l’accès':'אָפּהאַלטן צוטריט','Rétablir l’accès':'צוריקשטעלן צוטריט','Suspendre bloque immédiatement les opérations protégées. Le compte reste dans la liste et peut être réactivé ici.':'אָפּהאַלטן בלאָקירט גלייך באַשיצטע אַקציעס. דער חשבון בלייבט אין דער רשימה און קען דאָ ווידער אַקטיווירט ווערן.','Accès administrateur suspendu':'אַדמיניסטראַטאָר צוטריט אָפּגעהאַלטן','Le propriétaire YiDream a suspendu ce compte. Les données et appareils restent conservés, mais les actions administrateur sont bloquées. Contacte le propriétaire pour demander le rétablissement de l’accès.':'דער YiDream באַזיצער האָט אָפּגעהאַלטן דעם חשבון. די דאַטן און דיווייסעס ווערן געהיט, אָבער אַדמיניסטראַטאָר אַקציעס זענען בלאָקירט. קאָנטאַקטירט דעם באַזיצער וועגן צוריקשטעלן צוטריט.'}
};
for(const language of ['en','he','yi'])Object.assign(adminTranslations[language],ownerAccessTranslations[language]);

const deviceDetailTranslations={
 en:{'FICHE APPAREIL':'DEVICE RECORD','ÉTAT DE PRÉPARATION':'PREPARATION STATUS','CLIENT ASSOCIÉ':'ASSIGNED CLIENT','NOTE INTERNE':'INTERNAL NOTE','Configuré par le propriétaire':'Configured by owner','En attente de préparation':'Awaiting preparation','État de préparation non renseigné':'Preparation status not recorded','Non renseigné':'Not recorded','Aucun client associé':'No client assigned','Aucune note enregistrée.':'No note recorded.','Cette fiche confirme l’état enregistré dans YiDream. La présence ou la connexion USB de l’appareil n’est pas vérifiée en direct.':'This record shows the status saved in YiDream. Device presence and USB connection are not checked live.','L’état de préparation est validé par le propriétaire YiDream. La présence et la connexion USB ne sont pas détectées depuis cette liste.':'Preparation is verified by the YiDream owner. Device presence and USB connection are not detected from this list.','Ouvrir la configuration Android':'Open Android setup','Fermer cette fiche':'Close this record','Fermer':'Close','Retirer la fiche':'Remove record','Ajouté le':'Added on','APPAREIL ASSOCIÉ À LA FICHE':'DEVICE LINKED TO THIS RECORD'},
 he:{'FICHE APPAREIL':'רשומת מכשיר','ÉTAT DE PRÉPARATION':'מצב הכנה','CLIENT ASSOCIÉ':'לקוח משויך','NOTE INTERNE':'הערה פנימית','Configuré par le propriétaire':'הוגדר על ידי הבעלים','En attente de préparation':'ממתין להכנה','État de préparation non renseigné':'מצב ההכנה לא צוין','Non renseigné':'לא צוין','Aucun client associé':'לא משויך לקוח','Aucune note enregistrée.':'לא נשמרה הערה.','Cette fiche confirme l’état enregistré dans YiDream. La présence ou la connexion USB de l’appareil n’est pas vérifiée en direct.':'רשומה זו מציגה את המצב השמור ב‑YiDream. נוכחות המכשיר וחיבור USB אינם נבדקים בזמן אמת.','L’état de préparation est validé par le propriétaire YiDream. La présence et la connexion USB ne sont pas détectées depuis cette liste.':'הכנת המכשיר מאושרת על ידי בעל YiDream. נוכחות המכשיר וחיבור USB אינם מזוהים ברשימה זו.','Ouvrir la configuration Android':'פתיחת הגדרת Android','Fermer cette fiche':'סגירת רשומה','Fermer':'סגירה','Retirer la fiche':'הסרת רשומה','Ajouté le':'נוסף בתאריך','APPAREIL ASSOCIÉ À LA FICHE':'מכשיר המשויך לרשומה'},
 yi:{'FICHE APPAREIL':'דיווייס רעקאָרד','ÉTAT DE PRÉPARATION':'צושטאַנד פֿון צוגרייטונג','CLIENT ASSOCIÉ':'צוגעטיילטער קליענט','NOTE INTERNE':'אינערלעכע באַמערקונג','Configuré par le propriétaire':'קאָנפֿיגורירט דורך באַזיצער','En attente de préparation':'וואַרט אויף צוגרייטונג','État de préparation non renseigné':'צוגרייטונג צושטאַנד נישט אָנגעגעבן','Non renseigné':'נישט אָנגעגעבן','Aucun client associé':'קיין קליענט נישט צוגעטיילט','Aucune note enregistrée.':'קיין באַמערקונג נישט אויפֿגעהיט.','Cette fiche confirme l’état enregistré dans YiDream. La présence ou la connexion USB de l’appareil n’est pas vérifiée en direct.':'דער רעקאָרד ווײַזט דעם צושטאַנד וואָס איז אויפֿגעהיט אין YiDream. דער דיווייס און USB פֿאַרבינדונג ווערן נישט קאָנטראָלירט אין רעאַל־צײַט.','L’état de préparation est validé par le propriétaire YiDream. La présence et la connexion USB ne sont pas détectées depuis cette liste.':'די צוגרייטונג ווערט באַשטעטיקט דורך דעם YiDream באַזיצער. דער דיווייס און USB פֿאַרבינדונג ווערן נישט דערקענט אין דער רשימה.','Ouvrir la configuration Android':'עפֿענען Android קאָנפֿיגוראַציע','Fermer cette fiche':'צומאַכן דעם רעקאָרד','Fermer':'צומאַכן','Retirer la fiche':'אַראָפּנעמען רעקאָרד','Ajouté le':'צוגעגעבן דעם','APPAREIL ASSOCIÉ À LA FICHE':'דיווייס פֿאַרבונדן מיט רעקאָרד'}
};
for(const language of ['en','he','yi'])Object.assign(adminTranslations[language],deviceDetailTranslations[language]);
const simpleTranslations={
 en:{'Applications':'Apps','Configurer un téléphone':'Set up a phone','Gestion':'Management','Gestion propriétaire':'Owner management','Votre espace, simplement.':'Your workspace, made simple.','Préparez un téléphone ou retrouvez vos appareils.':'Set up a phone or find your devices.'},
 he:{'Applications':'יישומים','Configurer un téléphone':'הגדרת טלפון','Gestion':'ניהול','Gestion propriétaire':'ניהול בעלים','Votre espace, simplement.':'סביבת הניהול שלכם, בפשטות.','Préparez un téléphone ou retrouvez vos appareils.':'הכינו טלפון או מצאו את המכשירים שלכם.'},
 yi:{'Applications':'אַפּס','Configurer un téléphone':'איינשטעלן אַ טעלעפֿאָן','Gestion':'פאַרוואַלטונג','Gestion propriétaire':'באַזיצער פאַרוואַלטונג','Votre espace, simplement.':'אייער פּלאַץ, פּשוט.','Préparez un téléphone ou retrouvez vos appareils.':'גרייט צו אַ טעלעפֿאָן אָדער געפֿינט אייער דיווייסעס.'}
};
for(const language of ['en','he','yi'])Object.assign(adminTranslations[language],simpleTranslations[language]);
function translateAdminText(root=document){const dict=adminTranslations[adminLanguage];if(!dict)return;const walker=document.createTreeWalker(root,NodeFilter.SHOW_TEXT);const nodes=[];while(walker.nextNode())nodes.push(walker.currentNode);for(const node of nodes){const raw=node.nodeValue,trimmed=raw.trim();if(dict[trimmed])node.nodeValue=raw.replace(trimmed,dict[trimmed])}}
document.documentElement.lang=adminLanguage;document.documentElement.dir=['he','yi'].includes(adminLanguage)?'rtl':'ltr';translateAdminText();new MutationObserver(records=>{for(const record of records)for(const node of record.addedNodes)if(node.nodeType===Node.ELEMENT_NODE)translateAdminText(node);else if(node.nodeType===Node.TEXT_NODE)translateAdminText(node.parentElement||document)}).observe(document.getElementById('app')||document.body,{childList:true,subtree:true});

const withTimeout=(promise,label='connexion',ms=15000)=>Promise.race([promise,new Promise((_,reject)=>setTimeout(()=>reject(new Error(`Le chargement de ${label} prend trop de temps. Vérifiez votre connexion puis réessayez.`)),ms))]);
document.addEventListener('click',e=>{if(e.target.closest('.account-box'))return;const m=$('#accountMenu'),b=$('#accountToggle');if(m)m.classList.add('hidden');if(b)b.setAttribute('aria-expanded','false')});
document.addEventListener('keydown',e=>{if(e.key==='Escape'){const m=$('#accountMenu'),b=$('#accountToggle');if(m)m.classList.add('hidden');if(b)b.setAttribute('aria-expanded','false')}}); let state={session:null,data:null,page:'dashboard',deviceQuery:'',clientQuery:'',tab:'Tous',platformLabel:'',platformMenus:{},platformRole:null,ownerPage:'dashboard',ownerData:null,androidSection:'Connect',selectedDeviceId:null}; const names={dashboard:'Accueil',devices:'Appareils',clients:'Clients',activity:'Journal','mdm-catalog':MDM_TITLES.catalog,'mdm-requests':MDM_TITLES.requests,'mdm-pair':MDM_TITLES.pair};
// Integrated MDM views keep the Classic shell, account controls and existing management pages.
const initialMdmView=mdmViewFromHash(location.hash);
if(initialMdmView){state.page=mdmPage(initialMdmView);state.ownerPage=state.page;}
function mdmFrameMarkup(view){return `<section class="classic-mdm-view" data-mdm-view="${view}"><iframe id="classicMdmFrame" class="classic-mdm-frame" title="${esc(MDM_TITLES[view])} YiDream" src="${esc(mdmFrameSource(view,adminLanguage))}"></iframe></section>`;}
function navigateMdm(view,{updateHash=true}={}){
 const page=mdmPage(view);if(!page)return;
 state.page=page;state.ownerPage=page;state.platformLabel='';
 if(updateHash&&location.hash!=='#mdm-'+view)history.pushState(null,'',location.pathname+location.search+'#mdm-'+view);
 if(state.platformRole==='owner'&&state.ownerData)renderOwnerPortal();else if(state.data)render();
 window.scrollTo({top:0});
}
function clearMdmHash(){if(mdmViewFromHash(location.hash))history.replaceState(null,'',location.pathname+location.search);}
function bindMdmNavigation(){document.querySelectorAll('button[data-mdm-view]').forEach(b=>b.onclick=()=>navigateMdm(b.dataset.mdmView));}
window.addEventListener('hashchange',()=>{const view=mdmViewFromHash(location.hash);if(view||!location.hash)navigateMdm(view||'home',{updateHash:false});});
window.addEventListener('message',event=>{
 const frame=$('#classicMdmFrame'),message=trustedMdmMessage(event,frame,location.origin);if(!message)return;
 if(message.type==='resize')frame.style.height=message.height+'px';else if(message.type==='focus')frame.scrollIntoView({block:'start'});else navigateMdm(message.view);
});
function message(msg){const n=$('#authError')||$('#message');if(n)n.textContent=msg}
function notify(text){const n=document.createElement('div');n.textContent=text;n.style='position:fixed;bottom:22px;left:50%;transform:translateX(-50%);background:#102448;color:#fff;padding:11px 16px;border-radius:999px;z-index:20';document.body.append(n);setTimeout(()=>n.remove(),2200)}
async function refresh(){state.data=await withTimeout(cloud.loadData(),'des appareils et clients');render()}
window.toast ||= (text)=>notify(text);
const androidStyle=document.createElement('style');androidStyle.textContent=`#yd-gate{--surface:#fff;--text:#102448;--muted:#73819a;--line:#dce5f2;--shadow:0 12px 35px #1c3c7012;--soft:#f8f6ff;--blue:#7257d6}#androidWorkspace,#ownerAndroidWorkspace{--surface:#fff;--surface2:#f8f6ff;--text:#102448;--muted:#73819a;--line:#dce5f2;--blue:#7257d6;--red:#b42318;color:var(--text)}#androidWorkspace .stepper,#ownerAndroidWorkspace .stepper{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:8px;margin:15px 0}#androidWorkspace .step,#ownerAndroidWorkspace .step{padding:10px;border:1px solid var(--line);border-radius:10px;background:var(--surface);color:var(--muted);font-size:11px}#androidWorkspace .step.active,#ownerAndroidWorkspace .step.active{background:var(--pale);border-color:#c7baf0;color:var(--accent)}#androidWorkspace .android-config,#ownerAndroidWorkspace .android-config{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:14px}#androidWorkspace .panel,#ownerAndroidWorkspace .panel{background:#fff;border:1px solid var(--line);border-radius:14px;padding:17px;box-shadow:var(--shadow)}#androidWorkspace .panel h4,#ownerAndroidWorkspace .panel h4{margin:0 0 8px;font-size:13px}#androidWorkspace .status-pill,#ownerAndroidWorkspace .status-pill{display:inline-flex;border-radius:999px;padding:5px 10px;font-size:11px;font-weight:700}#androidWorkspace .status-pill.ok,#ownerAndroidWorkspace .status-pill.ok{background:#e7f6e9;color:#23823b}#androidWorkspace .status-pill.no,#ownerAndroidWorkspace .status-pill.no{background:#f0f2f7;color:#66738a}#androidWorkspace .device-row,#ownerAndroidWorkspace .device-row{display:flex;align-items:center;gap:12px;padding:12px;border:1px solid var(--line);border-radius:11px;background:#fff}#androidWorkspace .phone,#ownerAndroidWorkspace .phone{font-size:26px}#androidWorkspace .small,#ownerAndroidWorkspace .small{font-size:11px;color:var(--muted)}#androidWorkspace .notice,#ownerAndroidWorkspace .notice{padding:13px 15px;border-radius:11px;background:var(--pale);border:1px solid var(--line);color:var(--ink);font-size:12px}#androidWorkspace .log-box,#ownerAndroidWorkspace .log-box{margin-top:14px;padding:12px;border-radius:11px;background:#102448;color:#eaf0ff;font:11px/1.6 ui-monospace,Menlo,monospace;min-height:54px;max-height:190px;overflow:auto;white-space:pre-wrap}#androidWorkspace .form-grid,#ownerAndroidWorkspace .form-grid,#androidWorkspace .check-list,#ownerAndroidWorkspace .check-list{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px}#androidWorkspace .code-display,#ownerAndroidWorkspace .code-display{padding:14px;border-radius:12px;background:var(--soft);font-size:20px;font-weight:800;letter-spacing:.08em;text-align:center}#androidWorkspace .danger,#ownerAndroidWorkspace .danger{color:#b42318}#androidWorkspace button,#ownerAndroidWorkspace button{appearance:none;display:inline-flex;align-items:center;justify-content:center;gap:8px;min-height:42px;padding:10px 16px;border:1px solid var(--line);border-radius:10px;background:#fff;color:var(--text);font:700 13px/1.2 Inter,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;cursor:pointer;transition:transform .16s ease,box-shadow .16s ease,background .16s ease}#androidWorkspace button:hover,#ownerAndroidWorkspace button:hover{transform:translateY(-1px);box-shadow:0 8px 18px #10244818}#androidWorkspace button:focus-visible,#ownerAndroidWorkspace button:focus-visible{outline:3px solid #8b75ed66;outline-offset:2px}#androidWorkspace button:disabled,#ownerAndroidWorkspace button:disabled{opacity:.6;cursor:wait;transform:none}#androidWorkspace button.primary,#ownerAndroidWorkspace button.primary{border-color:transparent;background:linear-gradient(135deg,#7357d7,#5e45c3);color:#fff;box-shadow:0 7px 16px #7257d633}#androidWorkspace button.ghost,#ownerAndroidWorkspace button.ghost{background:#fff;color:var(--text)}#androidWorkspace input,#ownerAndroidWorkspace input{width:100%;min-height:42px;padding:10px 12px;border:1px solid var(--line);border-radius:9px;background:#fff;color:var(--text);font:500 13px/1.3 Inter,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}#androidWorkspace .unlock-panel,#ownerAndroidWorkspace .unlock-panel{display:grid;gap:15px;background:linear-gradient(145deg,#fff,#fbfaff)}#androidWorkspace .unlock-intro,#ownerAndroidWorkspace .unlock-intro{display:flex;align-items:center;gap:13px}#androidWorkspace .unlock-intro h4,#ownerAndroidWorkspace .unlock-intro h4,#androidWorkspace .apply-panel h4,#ownerAndroidWorkspace .apply-panel h4{font-size:15px;margin:0 0 4px}#androidWorkspace .unlock-intro p,#ownerAndroidWorkspace .unlock-intro p,#androidWorkspace .apply-panel p,#ownerAndroidWorkspace .apply-panel p{margin:0;color:var(--muted);font-size:12px;line-height:1.5}#androidWorkspace .unlock-badge,#ownerAndroidWorkspace .unlock-badge{width:42px;height:42px;display:grid;place-items:center;border-radius:13px;background:#f0ebff;font-size:20px;flex:none}#androidWorkspace .apply-panel,#ownerAndroidWorkspace .apply-panel{margin-top:12px;display:flex;align-items:center;justify-content:space-between;gap:18px}#androidWorkspace .code-display,#ownerAndroidWorkspace .code-display{margin-top:4px;padding:18px;border:1px solid #e4dcff;background:#f7f4ff;color:#4e36b6;font-size:30px;letter-spacing:.22em}#androidWorkspace .log-box,#ownerAndroidWorkspace .log-box{min-height:40px;border:1px solid #21385f}@media(max-width:540px){#androidWorkspace .apply-panel,#ownerAndroidWorkspace .apply-panel{align-items:stretch;flex-direction:column}}@media(max-width:760px){#androidWorkspace .stepper,#ownerAndroidWorkspace .stepper{grid-template-columns:repeat(2,minmax(0,1fr))}#androidWorkspace .android-config,#ownerAndroidWorkspace .android-config,#androidWorkspace .form-grid,#ownerAndroidWorkspace .form-grid,#androidWorkspace .check-list,#ownerAndroidWorkspace .check-list{grid-template-columns:1fr}}`;document.head.append(androidStyle);
const yzmStyle=document.createElement('style');yzmStyle.textContent=`.yzm-dashboard{display:grid;gap:18px}.yzm-hero{display:flex;align-items:center;justify-content:space-between;gap:18px;padding:22px 24px}.yzm-hero h2{margin:5px 0;font-size:22px}.yzm-hero p,.yzm-section-head p{margin:5px 0;color:var(--muted)}.yzm-hero small{color:var(--muted)}.yzm-eyebrow{font-size:10px;letter-spacing:.13em;font-weight:800;color:#7357d7}.yzm-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:12px}.yzm-stat{min-height:145px;padding:17px 18px;border:1px solid var(--line);border-radius:14px;background:#fff;box-shadow:0 8px 24px #1024480a;display:flex;flex-direction:column;gap:7px}.yzm-stat-top{display:flex;justify-content:space-between;align-items:center}.yzm-stat-icon{width:30px;height:30px;display:grid;place-items:center;border-radius:9px;background:#f1edff;color:#694ed0;font-weight:800}.yzm-stat label{font-size:12px;color:var(--muted);font-weight:700}.yzm-stat-value{font-size:28px;line-height:1.1;color:var(--ink)}.yzm-stat small{font-size:11px;line-height:1.45;color:var(--muted)}.yzm-source-status{font-size:10px;font-weight:700;border-radius:999px;padding:4px 8px}.yzm-source-status.ready{background:#e8f5ec;color:#267143}.yzm-source-status.unavailable{background:#f1f2f5;color:#68758b}.yzm-lower-grid{display:grid;grid-template-columns:minmax(0,1.4fr) minmax(290px,.8fr);gap:14px}.yzm-panel{padding:20px}.yzm-section-head{display:flex;align-items:flex-start;justify-content:space-between;gap:12px;margin-bottom:14px}.yzm-section-head h2{font-size:16px;margin:0}.yzm-period{font-size:11px;color:var(--muted)}.yzm-legend{display:flex;gap:16px;margin:0 0 12px;color:var(--muted);font-size:11px}.yzm-legend span{display:flex;align-items:center;gap:6px}.yzm-legend i{width:9px;height:9px;border-radius:50%}.yzm-chart{display:grid;gap:8px}.yzm-chart-row{display:grid;grid-template-columns:42px minmax(0,1fr) 35px;align-items:center;gap:9px;font-size:10px}.yzm-chart-row time{color:var(--muted)}.yzm-bars{display:grid;gap:2px;min-height:10px}.yzm-bar{height:4px;border-radius:99px;display:block}.yzm-chart-row b{text-align:right}.yzm-empty{padding:26px 12px;text-align:center;color:var(--muted);font-size:12px;background:#f8f9fc;border-radius:10px}.yzm-details{margin-top:16px;border-top:1px solid var(--line);padding-top:12px}.yzm-details summary{cursor:pointer;color:#6249c7;font-size:12px;font-weight:700}.yzm-source-list{display:grid;gap:8px}.yzm-source{padding:10px 11px;border:1px solid var(--line);border-radius:10px;display:flex;align-items:center;justify-content:space-between;gap:10px}.yzm-source div{display:grid;gap:3px}.yzm-source b{font-size:12px}.yzm-source small{font-size:10px;color:var(--muted)}.yzm-note{margin-top:12px;font-size:11px;line-height:1.5}.yzm-caveat{padding:0 2px;color:var(--muted);line-height:1.5}@media(max-width:900px){.yzm-grid{grid-template-columns:repeat(2,minmax(0,1fr))}.yzm-lower-grid{grid-template-columns:1fr}}@media(max-width:560px){.yzm-grid{grid-template-columns:1fr}.yzm-hero{align-items:flex-start;flex-direction:column}.yzm-stat{min-height:120px}}.app-filter-layout{display:grid;grid-template-columns:minmax(0,1.55fr) minmax(260px,.75fr);gap:12px;align-items:start}.app-filter-panel,.app-filter-side{padding:14px}.app-filter-toolbar{display:flex;justify-content:space-between;align-items:flex-start;gap:12px;margin-bottom:12px}.app-filter-toolbar h4{margin:0}.app-filter-toolbar p{max-width:560px;margin:5px 0 0}.app-filter-toolbar input{max-width:260px;min-height:38px}.app-filter-group{border-top:1px solid var(--line);padding:8px 0}.app-filter-group>summary{list-style:none;cursor:pointer;display:flex;justify-content:space-between;gap:10px;padding:6px 2px;font-size:12px;font-weight:750}.app-filter-group>summary::-webkit-details-marker{display:none}.app-filter-group>summary:after{content:'⌄';color:var(--muted)}.app-filter-group>summary small{margin-left:auto;color:var(--muted);font-weight:600}.app-filter-actions{display:flex;gap:7px;margin:3px 0 8px}.app-filter-actions button{min-height:30px;padding:5px 9px;font-size:10px}.app-filter-list{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:5px}.app-filter-row{display:flex;align-items:center;gap:8px;min-width:0;padding:7px 8px;border:1px solid var(--line);border-radius:8px;background:#fff;cursor:pointer}.app-filter-row input{width:15px;min-height:15px;flex:none;accent-color:var(--blue)}.app-filter-row span{display:grid;gap:2px;min-width:0}.app-filter-row b{font-size:11px}.app-filter-row small{font:9px/1.3 ui-monospace,Menlo,monospace;color:var(--muted);overflow-wrap:anywhere}.app-filter-side p{margin:7px 0 14px}.app-filter-summary{display:flex;align-items:center;gap:8px;padding:11px;border-radius:9px;background:#f3efff;color:var(--text);font-size:11px;margin:12px 0}.app-filter-summary b{font-size:19px;color:var(--blue)}.app-filter-row[hidden],.app-filter-group[hidden]{display:none}@media(max-width:760px){.app-filter-layout{grid-template-columns:1fr}.app-filter-toolbar{flex-direction:column}.app-filter-toolbar input{max-width:none;width:100%}}@media(max-width:480px){.app-filter-list{grid-template-columns:1fr}}`;document.head.append(yzmStyle);
const deviceDetailStyle=document.createElement('style');deviceDetailStyle.textContent=`.device-detail-card{margin:12px 0 16px;padding:18px}.device-detail-head{display:flex;justify-content:space-between;align-items:flex-start;gap:12px}.device-detail-head small,.device-detail-grid small{display:block;color:var(--muted);font-size:10px;font-weight:800;letter-spacing:.09em}.device-detail-head h2{margin:5px 0;font-size:20px}.device-detail-head p{margin:4px 0;color:var(--muted);font-size:12px}.device-detail-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px;margin:16px 0}.device-detail-grid>div{padding:12px;border:1px solid var(--line);border-radius:10px}.device-detail-grid b{display:block;margin-top:6px;font-size:13px}.device-detail-note{grid-column:1/-1}.device-detail-note p{margin:6px 0 0;color:var(--ink);font-size:12px}.device-detail-footer{display:flex;justify-content:space-between;align-items:center;gap:12px;border-top:1px solid var(--line);padding-top:12px}.device-detail-footer p{max-width:480px;color:var(--muted);font-size:11px;line-height:1.5}.device-detail-footer>div{display:flex;gap:8px;flex-wrap:wrap}.android-device-context{display:flex;align-items:center;justify-content:space-between;gap:14px;margin:12px 0;padding:13px 16px}.android-device-context>div{display:grid;gap:3px}.android-device-context small{color:var(--muted);font-size:9px;font-weight:800;letter-spacing:.1em}.android-device-context b{font-size:14px}.android-device-context span{font-size:11px;color:var(--muted)}@media(max-width:650px){.device-detail-footer{align-items:flex-start;flex-direction:column}.device-detail-grid{grid-template-columns:1fr}.android-device-context{align-items:flex-start;flex-direction:column}}`;document.head.append(deviceDetailStyle);


function androidLabels(){return adminLanguage==='fr'?{'Connect':'Connexion','Install YiDream':'Installer YiDream','Device Owner':'Administrateur de l’appareil','Configuration':'Configuration','Unlock & Apply':'Déverrouiller et appliquer','Advanced':'Avancé','Logs':'Journal','Settings':'Paramètres'}:adminLanguage==='he'?{'Connect':'חיבור','Install YiDream':'התקנת YiDream','Device Owner':'בעלים של המכשיר','Configuration':'הגדרה','Unlock & Apply':'פתיחה והחלה','Advanced':'מתקדם','Logs':'יומן','Settings':'הגדרות'}:adminLanguage==='yi'?{'Connect':'פֿאַרבינדן','Install YiDream':'ינסטאַלירן YiDream','Device Owner':'דיווייס באַזיצער','Configuration':'קאַנפֿיגוראַציע','Unlock & Apply':'עפֿענען און אָנווענדן','Advanced':'אַוואַנסירט','Logs':'לאָג','Settings':'סעטינגס'}:{}};
function mountAndroidWorkspace(host) {
 const owner = state.platformRole === 'owner';
 const source = owner ? state.ownerData : state.data;
 const targetDevice = source?.devices?.find(device => device.id === state.selectedDeviceId);
 host.innerHTML = '<div id="androidWorkspace"></div>';
 renderAndroidWizard(host.querySelector('#androidWorkspace'), {
  owner, targetDevice, language: adminLanguage, api: cloud, openRecord: openDeviceRecord
 });
}

function openAndroidConfigurator(deviceId = null) {
 clearMdmHash();
 runGate();
 state.selectedDeviceId = typeof deviceId === 'string' ? deviceId : null;
 if (state.platformRole === 'owner') {
  state.ownerPage = 'android';
  renderOwnerPortal();
 } else {
  state.page = 'android';
  render();
 }
}

async function openDeviceRecord(id) {
 const owner = state.platformRole === 'owner';
 const userId = state.session?.user?.id;
 const data = await withTimeout(owner ? cloud.loadOwnerData() : cloud.loadData(), 'des appareils et clients');
 if (state.session?.user?.id !== userId) return;
 clearMdmHash();
 state.selectedDeviceId = id;
 if (owner) {
  state.ownerData = data;
  state.ownerPage = 'devices';
  renderOwnerPortal();
 } else {
  state.data = data;
  state.page = 'devices';
  state.tab = 'Tous';
  state.platformLabel = '';
  render();
 }
}

function portalHomeHref(){return 'https://yidreamkosher.github.io/YiDream/'}
function appNavigation(){
 const page=state.platformRole==='owner'?state.ownerPage:state.page;
 return `<nav class="suite-main-nav" aria-label="Navigation principale"><button type="button" data-mdm-view="catalog" ${page==='mdm-catalog'?'aria-current="page"':''}><span>▦</span>Applications</button><button type="button" data-mdm-view="requests" ${page==='mdm-requests'?'aria-current="page"':''}><span>◎</span>Demandes de sites</button><button type="button" data-open-android ${page==='android'?'aria-current="page"':''}><span>▯</span>Configurer un téléphone</button></nav>`;
}
function welcomeMarkup(){return `<section class="suite-welcome"><div><span class="suite-eyebrow">YiDream Suite</span><h1>Votre espace, simplement.</h1><p>Préparez un téléphone ou retrouvez vos appareils.</p></div><button type="button" class="button primary" data-open-android>Configurer un téléphone <span aria-hidden="true">→</span></button></section>`;}

const appNavigationStyle=document.createElement('style');appNavigationStyle.textContent=`.app-links{display:grid;gap:14px;padding:0 4px 16px}.app-link-group{display:grid;gap:3px}.app-group-label{padding:0 9px 5px;color:#8793a7;font-size:9px;font-weight:850;letter-spacing:.12em;text-transform:uppercase}.app-link{position:relative;width:100%;min-height:40px;display:flex;align-items:center;gap:10px;padding:8px 9px;border:1px solid transparent;border-radius:10px;background:transparent;color:#536178;text-decoration:none;text-align:left;font:650 11px/1.25 Inter,-apple-system,BlinkMacSystemFont,Segoe UI,sans-serif;cursor:pointer;transition:background .16s ease,border-color .16s ease,color .16s ease,transform .16s ease}.app-link:hover,.app-link.active,.app-link[aria-current="page"]{background:#f1edff;border-color:#e6defd;color:#6348c5}.app-link:hover{transform:translateX(2px)}.app-link.active,.app-link[aria-current="page"]{font-weight:800}.app-link-icon{width:24px;height:24px;display:grid;place-items:center;flex:none;border-radius:8px;background:#f4f6fa;color:#64748b;font-size:14px}.app-link:hover .app-link-icon,.app-link.active .app-link-icon,.app-link[aria-current="page"] .app-link-icon{background:#fff;color:#7257d6}.app-link-icon img{width:100%;height:100%;object-fit:contain}.app-link small{margin-left:auto;padding:3px 6px;border-radius:6px;background:#fff4dc;color:#98712e;font-size:8px;font-weight:800}.app-link.coming{opacity:.76;cursor:not-allowed}.app-link-arrow{margin-left:auto;color:#98a2b4;font-size:15px}.app-link-apple{position:relative;font-size:0!important;width:15px;height:16px;margin:0 4px;border-radius:48% 48% 44% 44%;background:#172846!important}.app-link-apple:before{content:"";position:absolute;right:-3px;top:-2px;width:6px;height:4px;border-radius:6px 0;background:#172846;transform:rotate(-38deg)}.app-link:focus-visible{outline:3px solid #9e8bea;outline-offset:2px}`;document.head.append(appNavigationStyle);
function authScreen(mode='login',error=''){
 const register=mode==='register';
 app.innerHTML=`<div class="auth-wrap"><section class="auth"><button class="link" id="authBack" style="margin:0 0 12px;padding:0">← Retour à la présentation</button><a href="${portalHomeHref()}" class="brand" style="padding:0 0 20px"><img src="${logoUrl}" alt=""> YiDream <span style="color:#73819a;font-weight:500">Suite</span></a><h1>${register?'Demander un accès administrateur':'Connexion administrateur'}</h1><p>${register?'Créez votre compte puis envoyez votre candidature. L’accès sera activé après examen.':'Connectez-vous pour gérer les appareils et les comptes autorisés.'}</p>
 <div id="authError" class="msg">${esc(error)}</div>
 ${register?'<div class="field"><label>Nom de la boutique ou organisation</label><input id="shop" autocomplete="organization"></div>':''}
 <div class="field"><label>Adresse e-mail</label><input id="email" type="email" autocomplete="email"></div><div class="field"><label>Mot de passe</label><input id="password" type="password" autocomplete="${register?'new-password':'current-password'}"></div>
 ${register?'<div class="field"><label>Confirmer le mot de passe</label><input id="confirm" type="password" autocomplete="new-password"></div>':''}
 <div class="notice" style="margin:12px 0">Vos coordonnées et le nom de votre organisation servent à examiner votre demande et à gérer votre accès. Les fonctions d’administration sont réservées aux comptes approuvés.</div>
 <label style="display:flex;gap:9px;align-items:flex-start;font-size:11px;color:#536178;margin:12px 0"><input id="consent" type="checkbox" style="margin-top:2px"> J’ai lu cette information et je comprends que l’accès administrateur nécessite une approbation.</label>
 <button id="submit" class="button primary" disabled>${register?'Créer mon compte':'Se connecter'}</button><div class="or">ou</div><button id="google" class="button google-button" disabled><span class="google-mark" aria-hidden="true">G</span>Continuer avec Google</button>
 <p style="font-size:11px;margin:18px 0 0;text-align:center">${register?'Déjà inscrit ?':'Vous souhaitez gérer YiDream ?'} <button class="link" id="swap">${register?'Se connecter':'Demander un accès'}</button></p></section></div>`;
 $('#authBack').onclick=publicPortal;
 $('#swap').onclick=()=>authScreen(register?'login':'register');
 $('#consent').onchange=()=>{const ok=$('#consent').checked;$('#submit').disabled=!ok;$('#google').disabled=!ok};
 $('#google').onclick=async()=>{const b=$('#google');b.disabled=true;b.textContent='Redirection vers Google…';try{await cloud.signInGoogle()}catch(e){authScreen(mode,errorText(e))}};
 $('#submit').onclick=async()=>{
  const email=$('#email').value.trim(),password=$('#password').value;
  if(!$('#consent').checked){message('Veuillez confirmer la notice avant de continuer.');return}
  if(register&&password!==$('#confirm').value){message('Les mots de passe ne correspondent pas.');return}
  const b=$('#submit');b.disabled=true;b.textContent='Patientez…';
  try{
   if(register){const d=await cloud.signUp({shopName:$('#shop').value,email,password});if(!d.session){authScreen('login','Vérifiez votre e-mail pour confirmer votre compte, puis connectez-vous.');return}}
   else await cloud.signIn({email,password});
   await start();
  }catch(e){b.disabled=false;b.textContent=register?'Créer mon compte':'Se connecter';message(errorText(e))}
 };
}
function publicPortal(){
 app.innerHTML=`<div class="auth-wrap" style="display:block;padding:0"><header style="max-width:1120px;margin:auto;padding:22px 24px;display:flex;justify-content:space-between;align-items:center;gap:16px"><a class="brand" href="${portalHomeHref()}" style="padding:0"><img src="${logoUrl}" alt="">YiDream <span style="color:#73819a;font-weight:500">Suite</span></a><div class="actions"><button class="button" id="portalLogin">Se connecter</button><button class="button primary" id="portalApply">Postuler comme administrateur</button></div></header><main style="max-width:1120px;margin:0 auto;padding:72px 24px"><span class="role">PORTAIL ADMINISTRATEUR</span><h1 style="max-width:760px;font-size:clamp(36px,6vw,62px);margin-top:22px">Gérez les appareils YiDream dans un espace sécurisé.</h1><p style="max-width:700px;color:#73819a;font-size:18px;line-height:1.65">La Suite réunit la préparation Android, le suivi des appareils et la gestion des clients et des magasins. Les outils de configuration sont réservés aux administrateurs approuvés.</p><div class="actions" style="margin:26px 0 45px"><button class="button primary" id="portalAccess">Accéder à la console</button><button class="button" id="portalApplySecond">Déposer une candidature</button></div><div class="stats" style="grid-template-columns:repeat(auto-fit,minmax(220px,1fr));max-width:900px"><div class="stat"><label>Préparation Android</label><strong style="font-size:20px">Disponible</strong><small>Configuration depuis un appareil raccordé en USB</small></div><div class="stat"><label>Accès contrôlé</label><strong style="font-size:20px">Sur approbation</strong><small>Chaque candidature est examinée par YiDream</small></div></div><section class="panel" style="max-width:900px;margin-top:22px;padding:24px"><h2>Comment rejoindre l’espace ?</h2><p style="color:#73819a;line-height:1.6">Connectez-vous avec votre compte Google ou votre adresse e-mail, indiquez votre boutique et envoyez votre candidature. En attendant l’approbation, les appareils, clients et fonctions de configuration restent inaccessibles.</p><button class="button primary" id="portalApplyThird">Postuler pour devenir administrateur</button></section></main></div>`;
 const login=()=>authScreen('login'), apply=()=>authScreen('register');
 $('#portalLogin').onclick=login;$('#portalAccess').onclick=login;$('#portalApply').onclick=apply;$('#portalApplySecond').onclick=apply;$('#portalApplyThird').onclick=apply;
}
function errorText(e){const m=typeof e==='string'?e:(e?.message||'');if(/flow_state_already_used|state has already been used|state.*already.*used/i.test(m))return 'Ce lien de connexion Google a déjà été utilisé ou n’est plus valide. Recommencez depuis le bouton Google ; ne rechargez pas cette ancienne adresse.';if(/Invalid login credentials/i.test(m))return 'Adresse e-mail ou mot de passe incorrect.';if(/Email not confirmed/i.test(m))return 'Confirmez votre adresse e-mail avant de vous connecter.';if(/provider.*not enabled|unsupported provider/i.test(m))return 'La connexion Google doit être activée dans Supabase Auth → Providers → Google avec des identifiants OAuth Google.';if(/redirect_uri_mismatch|redirect URI mismatch/i.test(m))return 'Google refuse l’adresse de retour. Vérifiez l’URI de rappel configurée dans Google Cloud.';if(/invalid_client|unauthorized_client|client authentication failed/i.test(m))return 'Google refuse l’identifiant OAuth. Vérifiez le Client ID et le Client Secret dans Supabase.';if(/redirect.*(url|uri)|not allowed/i.test(m))return 'Cette adresse de retour n’est pas autorisée dans Supabase Auth → URL Configuration.';return m||'Une erreur est survenue.'}
function oauthErrorFromUrl(){const p=new URLSearchParams(location.search);const m=p.get('error_description')||p.get('error_code')||p.get('error');return m?errorText(m):''}
async function onboarding(error=''){
 mountApplicationForm(app,{email:state.session?.user?.email||'',submit:async details=>{const application=await cloud.submitAdminApplication(details);pendingScreen(application);},logout:async()=>{await cloud.signOut();state.session=null;state.data=null;publicPortal();}});
}

function pendingScreen(application){
 const status=application?.status;
 const text=status==='rejected'?'Votre candidature n’a pas été approuvée. Vous pouvez contacter YiDream ou déposer une nouvelle demande.':status==='approved'?'La candidature a été approuvée, mais les droits de ce compte ne sont plus actifs. Contactez le propriétaire pour rétablir votre accès.':'Votre demande a bien été enregistrée. Le propriétaire YiDream va examiner vos réponses. Vos outils seront ouverts après approbation.';
 app.innerHTML=`<div class="auth-wrap"><section class="auth"><a href="${portalHomeHref()}" class="brand"><img src="${logoUrl}" alt="">YiDream <span class="suite-word">Suite</span></a><h1>${status==='rejected'?'Candidature examinée':status==='approved'?'Accès à rétablir':'Votre candidature est en attente'}</h1><p>${esc(text)}</p><p class="mail-status" id="applicationMailStatus" role="status">Vérification du suivi par e-mail…</p><button class="button primary" id="refreshApplication">Actualiser mon statut</button>${status==='rejected'?'<button class="button" id="pendingApply" style="margin-top:12px">Déposer une nouvelle candidature</button>':''}<button class="link" id="pendingLogout" style="display:block;margin:18px auto 0">Se déconnecter</button></section></div>`;
 $('#refreshApplication').onclick=start;
 if($('#pendingApply'))$('#pendingApply').onclick=()=>onboarding();
 $('#pendingLogout').onclick=async()=>{await cloud.signOut();state.session=null;publicPortal()};
 cloud.applicationEmailStatus(application.id).then(rows=>{const el=$('#applicationMailStatus');if(!el)return;const event=rows?.find(x=>x.event===status);el.textContent=event?.status==='sent'?'Le message de suivi a été envoyé à votre adresse e-mail.':'Votre demande est enregistrée. Le message de suivi est en attente d’envoi.';});
}

function shell(){
 const d=state.data;
 const initials=(d.profile.shop_name||'Y').trim().slice(0,2).toLocaleUpperCase('fr-FR');
 app.innerHTML=`<div class="shell"><aside class="side"><div class="brand"><img src="${adminLogoUrl}" alt="Logo YiDream Admin">YiDream <span class="suite-word">Suite</span></div><div class="workspace">Espace de gestion</div><nav class="nav"><button data-page="dashboard"><span class="ico">⌂</span>Accueil</button><button data-page="devices"><span class="ico">▣</span>Appareils</button></nav>${appNavigation()}<details class="suite-secondary" ${['clients','activity','mdm-pair'].includes(state.page)?'open':''}><summary>Gestion</summary><nav class="nav"><button data-page="clients">Clients</button><button data-mdm-view="pair">Associer un appareil</button><button data-page="activity">Journal d’activité</button></nav></details><div class="side-bottom"><div class="account-box"><button id="accountToggle" class="account-trigger" aria-expanded="false" aria-controls="accountMenu"><span class="avatar">${esc(initials)}</span><span class="account-copy"><b>${esc(d.profile.shop_name)}</b><small>${esc(state.session.user.email)}</small></span><span class="account-caret">⌃</span></button><div id="accountMenu" class="account-menu hidden"><div class="account-menu-head"><small>COMPTE REVENDEUR</small><b>${esc(d.profile.shop_name)}</b><span>${esc(state.session.user.email)}</span></div><div class="account-menu-rule"></div><button id="accountSettings" class="logout-button" style="border-color:var(--line);background:#fff;color:var(--ink);margin-bottom:7px">Paramètres du compte</button><button id="logout" class="logout-button">Se déconnecter</button></div></div></div></aside><main class="main"><header class="topbar"><span class="crumb">YiDream Suite / <b id="crumb">${state.platformLabel||names[state.page]}</b></span><div class="top-actions"><span class="role">ESPACE ADMINISTRATEUR</span><span class="hebrew-decor" dir="rtl" lang="he" aria-hidden="true">בס״ד</span></div></header><section class="content" id="content"></section></main></div>`;
 document.querySelectorAll('[data-page]').forEach(b=>{b.classList.toggle('active',b.dataset.page===state.page&&!state.platformLabel);b.onclick=()=>{if(b.dataset.page==='dashboard'){navigateMdm('home');return}clearMdmHash();state.page=b.dataset.page;state.platformLabel='';state.tab='Tous';render()}});
 $('#accountToggle').onclick=()=>{const b=$('#accountToggle'),m=$('#accountMenu'),open=m.classList.contains('hidden');m.classList.toggle('hidden',!open);b.setAttribute('aria-expanded',String(open))};
 $('#accountSettings').onclick=()=>{const p=state.data.profile;const overlay=document.createElement('div');overlay.id='accountSettingsDialog';overlay.style='position:fixed;inset:0;z-index:100;display:grid;place-items:center;padding:18px;background:#10244866';overlay.innerHTML='<section style="width:min(460px,100%);padding:24px;border:1px solid var(--line);border-radius:18px;background:#fff;box-shadow:0 20px 60px #10244830"><div style="display:flex;justify-content:space-between;align-items:center;gap:12px"><h2 style="margin:0;font-size:20px">Paramètres du compte</h2><button type="button" id="settingsClose" class="button" aria-label="Fermer">×</button></div><p style="color:var(--muted);margin:8px 0 18px">Modifiez les informations de votre compte revendeur.</p><div class="field"><label for="settingsShop">Nom de la boutique ou organisation</label><input id="settingsShop" value="'+esc(p.shop_name)+'"></div><div class="field" style="margin-top:14px"><label for="settingsEmail">Adresse e-mail</label><input id="settingsEmail" value="'+esc(state.session.user.email)+'" disabled></div><div class="field" style="margin-top:14px"><label for="settingsLanguage">Langue de l’espace administrateur</label><select id="settingsLanguage"><option value="fr">Français</option><option value="en">English</option><option value="he">עברית</option><option value="yi">ייִדיש</option></select></div><div class="actions" style="justify-content:flex-end;margin-top:20px"><button type="button" id="settingsCancel" class="button">Annuler</button><button type="button" id="settingsSave" class="button primary">Enregistrer</button></div><p id="settingsError" class="msg"></p></section>';document.body.append(overlay);translateAdminText(overlay);const language=overlay.querySelector('#settingsLanguage');language.value=adminLanguage;const close=()=>overlay.remove();overlay.querySelector('#settingsClose').onclick=close;overlay.querySelector('#settingsCancel').onclick=close;overlay.onclick=e=>{if(e.target===overlay)close()};overlay.querySelector('#settingsSave').onclick=async()=>{const name=overlay.querySelector('#settingsShop').value.trim();if(!name){overlay.querySelector('#settingsError').textContent='Saisissez un nom pour la boutique.';return}try{if(name!==p.shop_name){await cloud.updateShopName(name);state.data.profile.shop_name=name}localStorage.setItem('yidream-admin-language',language.value);location.reload()}catch(e){overlay.querySelector('#settingsError').textContent=errorText(e)}}};

 $('#logout').onclick=async()=>{await disconnectAndroidWorkspace().catch(()=>{});await cloud.signOut();state.session=null;state.data=null;authScreen()};
 bindMdmNavigation();
 document.querySelectorAll('[data-platform-toggle]').forEach(b=>b.onclick=()=>{const name=b.dataset.platformToggle;state.platformMenus[name]=!state.platformMenus[name];render()});
 document.querySelectorAll('[data-platform-action]').forEach(b=>b.onclick=openAndroidConfigurator);document.querySelectorAll('[data-open-android]').forEach(b=>b.onclick=openAndroidConfigurator);
}

function renderOwnerPortal(){
 if(state.ownerPage!=='android')disposeAndroidWizard();
 const d=state.ownerData||{applications:[],admins:[],stores:[],clients:[],devices:[],logs:[]};
 const tabs=[['dashboard','Accueil'],['yzmdm','Statistiques YZ MDM'],['applications','Candidatures'],['admins','Administrateurs'],['stores','Magasins'],['clients','Clients'],['devices','Appareils']];
 const ownerNavButton=([key,label])=>`<button data-owner-page="${key}" class="${state.ownerPage===key?'active':''}">${label}</button>`;
 const tabButtons=tabs.filter(([key])=>['dashboard','devices'].includes(key)).map(ownerNavButton).join('');
 const ownerManagement=`<details class="suite-secondary" ${['applications','admins','stores','clients','yzmdm','mdm-pair'].includes(state.ownerPage)?'open':''}><summary>Gestion propriétaire</summary><nav class="nav">${tabs.filter(([key])=>!['dashboard','devices'].includes(key)).map(ownerNavButton).join('')}<button data-mdm-view="pair">Associer un appareil</button></nav></details>`;
 const mdmView=mdmViewForPage(state.ownerPage);
 let body='';
 if(mdmView&&mdmView!=='home'){
  body=mdmFrameMarkup(mdmView);
 }else if(state.ownerPage==='yzmdm'){
  body='<section class="panel" id="yzMdmStats"><div class="empty">Chargement des statistiques YZ MDM…</div></section>';
 }else if(state.ownerPage==='android'){
  body='<div id="ownerAndroidWorkspace"></div>';
 }else if(state.ownerPage==='dashboard'){
  body='';
 }else if(state.ownerPage==='applications'){
  body=applicationReviewMarkup(d.applications);
 }else if(state.ownerPage==='admins'){
  body=`<section class="panel"><h2>Comptes administrateur</h2><p class="small">Suspendre bloque immédiatement les opérations protégées. Le compte reste dans la liste et peut être réactivé ici.</p><div class="table-wrap"><table class="table"><thead><tr><th>Adresse du compte</th><th>Rôle</th><th>État d’accès</th><th>Ajouté le</th><th></th></tr></thead><tbody>${d.admins.map(x=>{const active=x.is_active!==false;return `<tr><td>${esc(x.email||x.user_id)}</td><td>${x.role==='owner'?'Propriétaire':'Administrateur'}</td><td><span class="badge">${x.role==='owner'?'Protégé':active?'Actif':'Suspendu'}</span></td><td>${new Date(x.created_at).toLocaleDateString('fr-FR')}</td><td>${x.role==='admin'?'<button class="link" data-admin-access="'+x.user_id+'" data-enabled="'+(!active)+'">'+(active?'Suspendre l’accès':'Rétablir l’accès')+'</button>':''}</td></tr>`}).join('')}</tbody></table></div></section>`;
 }else if(state.ownerPage==='stores'){
  body=`<section class="panel"><h2>Magasins et organisations</h2><div class="table-wrap"><table class="table"><thead><tr><th>Magasin</th><th>Adresse</th><th>Clients</th><th>Appareils</th><th></th></tr></thead><tbody>${d.stores.map(x=>`<tr><td>${esc(x.shop_name)}</td><td>${esc(x.email)}</td><td>${d.clients.filter(y=>y.user_id===x.user_id).length}</td><td>${d.devices.filter(y=>y.user_id===x.user_id).length}</td><td><button class="link" data-store-edit="${x.user_id}">Renommer</button></td></tr>`).join('')||'<tr><td colspan="5">Aucun magasin enregistré.</td></tr>'}</tbody></table></div></section>`;
 }else if(state.ownerPage==='clients'){
  body=`<section class="panel"><h2>Tous les clients</h2><div class="table-wrap"><table class="table"><thead><tr><th>Client</th><th>Groupe</th><th>Magasin</th><th></th></tr></thead><tbody>${d.clients.map(x=>{const store=d.stores.find(s=>s.user_id===x.user_id);return `<tr><td>${esc(x.name)}</td><td>${esc(x.group_name||'—')}</td><td>${esc(store?.shop_name||x.user_id)}</td><td><button class="link" data-client-remove="${x.id}">Retirer</button></td></tr>`}).join('')||'<tr><td colspan="4">Aucun client.</td></tr>'}</tbody></table></div></section>`;
 }else{
  body=ownerDeviceList(d);
 }
 if(mdmView==='home')body=welcomeMarkup()+mdmFrameMarkup('home')+`<section class="suite-owner-summary"><span>Gestion propriétaire</span><div><button class="link" data-owner-page="applications">${d.applications.filter(x=>x.status==='pending').length} candidatures en attente →</button><button class="link" data-owner-page="admins">Gérer les administrateurs →</button></div></section>`;
 app.innerHTML=`<div class="shell"><aside class="side"><div class="brand"><img src="${adminLogoUrl}" alt="Logo YiDream Admin">YiDream <span class="suite-word">Suite</span></div><div class="workspace">Console propriétaire</div><nav class="nav">${tabButtons}</nav>${appNavigation()}${ownerManagement}<div class="side-bottom"><div class="account-copy"><b>${esc(state.session?.user?.email||'Propriétaire')}</b><small>Gestion globale YiDream</small></div><button id="ownerLogout" class="logout-button" style="margin-top:12px">Se déconnecter</button></div></aside><main class="main"><header class="topbar"><span class="crumb">YiDream Suite / <b>${mdmView?MDM_TITLES[mdmView]:state.ownerPage==='android'?'Configurer un téléphone':tabs.find(x=>x[0]===state.ownerPage)?.[1]||'Administration'}</b></span><div class="top-actions"><span class="role">PROPRIÉTAIRE</span><span class="hebrew-decor" dir="rtl" lang="he" aria-hidden="true">בס״ד</span></div></header><section class="content owner-content ${mdmView==='home'?'owner-content-home':''}">${mdmView||state.ownerPage==='android'?'':head(tabs.find(x=>x[0]===state.ownerPage)?.[1]||'Administration','')}${body}</section></main></div>`;
 document.querySelectorAll('[data-owner-page]').forEach(b=>b.onclick=()=>{if(b.dataset.ownerPage==='dashboard'){navigateMdm('home');return}clearMdmHash();state.ownerPage=b.dataset.ownerPage;renderOwnerPortal()});document.querySelectorAll('[data-open-android]').forEach(b=>b.onclick=openAndroidConfigurator);if(state.ownerPage==='android')mountAndroidWorkspace($('#ownerAndroidWorkspace'));
 $('#ownerLogout').onclick=async()=>{await disconnectAndroidWorkspace().catch(()=>{});await cloud.signOut();state.session=null;state.data=null;state.ownerData=null;publicPortal()};
 document.querySelectorAll('[data-review]').forEach(b=>b.onclick=async()=>{try{await cloud.reviewAdminApplication(b.dataset.id,b.dataset.review==='approve');await reloadOwner()}catch(e){notify(errorText(e))}});
 document.querySelectorAll('[data-application-mail]').forEach(button=>{const id=button.dataset.applicationMail;const status=document.getElementById('mail-'+id);const update=async()=>{const rows=await cloud.applicationEmailStatus(id);if(status)status.textContent=rows?.some(x=>x.event===button.dataset.applicationStatus&&x.status==='sent')?'Message de suivi envoyé':'Message de suivi en attente';};update();button.onclick=async()=>{button.disabled=true;try{await cloud.sendApplicationEmail(id);await update();}finally{button.disabled=false;}};});
 document.querySelectorAll('[data-admin-access]').forEach(b=>b.onclick=async()=>{const enabled=b.dataset.enabled==='true';if(enabled&&!confirm('Rétablir l’accès administrateur de ce compte ?'))return;if(!enabled&&!confirm('Suspendre l’accès administrateur de ce compte ? Ses données seront conservées.'))return;try{await cloud.setPlatformAdminAccess(b.dataset.adminAccess,enabled);await reloadOwner()}catch(e){notify(errorText(e))}});
 document.querySelectorAll('[data-store-edit]').forEach(b=>b.onclick=async()=>{const store=d.stores.find(x=>x.user_id===b.dataset.storeEdit);const name=prompt('Nouveau nom de la boutique',store?.shop_name||'');if(name?.trim())try{await cloud.updateStoreName(b.dataset.storeEdit,name);await reloadOwner()}catch(e){notify(errorText(e))}});
 document.querySelectorAll('[data-client-remove]').forEach(b=>b.onclick=async()=>{if(confirm('Retirer ce client ?'))try{await cloud.removeClient(b.dataset.clientRemove);await reloadOwner()}catch(e){notify(errorText(e))}});
 document.querySelectorAll('[data-device-ready]').forEach(b=>b.onclick=async()=>{try{await cloud.setDeviceConfigured(b.dataset.deviceReady,b.dataset.ready==='true');await reloadOwner()}catch(e){notify(errorText(e))}});
 if (state.ownerPage === 'devices') {
  document.querySelectorAll('[data-device-detail]').forEach(button => {
   button.onclick = () => {
    state.selectedDeviceId = button.dataset.deviceDetail;
    renderOwnerPortal();
   };
  });
  bindDeviceDetails(d, () => renderOwnerPortal(), reloadOwner);
  bindDeviceSearch();
 }
 bindMdmNavigation();
 if(state.ownerPage==='yzmdm') loadYzMdmDashboard($('#yzMdmStats'),d);
}

async function loadYzMdmDashboard(host,ownerData){
 if(!host)return;
 const endpoint='https://api.github.com/repos/YiDreamKosher/YZ-MDM';
 const headers={Accept:'application/vnd.github+json'};
 const getJson=async url=>{const r=await fetch(url,{headers});if(!r.ok)throw new Error('GitHub HTTP '+r.status);return r.json()};
 const getAllPages=async url=>{
  const all=[];let next=url;let pages=0;
  while(next&&pages<20){
   const response=await fetch(next,{headers});
   if(!response.ok)throw new Error('GitHub HTTP '+response.status);
   const values=await response.json();
   if(!Array.isArray(values))throw new Error('Réponse GitHub inattendue');
   all.push(...values);
   const link=response.headers.get('Link')||'';
   const match=link.match(/<([^>]+)>;\s*rel="next"/);
   next=match?match[1]:null;pages++;
  }
  if(next)throw new Error('La pagination GitHub est incomplète.');
  return all;
 };
 const results=await Promise.allSettled([
  cloud.loadYzMdmMetrics(30),
  getAllPages(endpoint+'/releases?per_page=100'),
  getJson(endpoint+'/actions/runs?per_page=30'),
  getAllPages(endpoint+'/issues?state=open&per_page=100')
 ]);
 const metricsReady=results[0].status==='fulfilled';
 const releasesReady=results[1].status==='fulfilled';
 const runsReady=results[2].status==='fulfilled';
 const issuesReady=results[3].status==='fulfilled';
 const rows=metricsReady?results[0].value:[];
 const releases=releasesReady?results[1].value:[];
 const runs=runsReady?(results[2].value.workflow_runs||[]):[];
 const issues=issuesReady?results[3].value.filter(x=>!x.pull_request):[];
 const total=metric=>rows.filter(x=>x.metric===metric).reduce((sum,x)=>sum+Number(x.count||0),0);
 const downloads=releases.reduce((sum,release)=>sum+(release.assets||[]).reduce((n,asset)=>n+Number(asset.download_count||0),0),0);
 const failedRuns=runs.filter(x=>x.conclusion==='failure').length;
 const pending=ownerData.applications.filter(x=>x.status==='pending').length;
 const days=Array.from({length:14},(_,i)=>{const d=new Date();d.setDate(d.getDate()-(13-i));return d.toISOString().slice(0,10)});
 const series=[
  {key:'site_visit',label:'Visites',color:'#7357d7'},
  {key:'webadb_connected',label:'WebADB',color:'#2b8a78'},
  {key:'launcher_installed',label:'Installations',color:'#d08a26'}
 ];
 const dailyValue=(day,key)=>rows.filter(x=>x.day===day&&x.metric===key).reduce((sum,x)=>sum+Number(x.count||0),0);
 const chartMax=Math.max(1,...days.flatMap(day=>series.map(item=>dailyValue(day,item.key))));
 const chartRows=days.map(day=>{
  const totalDay=series.reduce((sum,item)=>sum+dailyValue(day,item.key),0);
  const bars=series.map(item=>{
   const value=dailyValue(day,item.key);
   const width=value?Math.max(2,Math.round(value/chartMax*100)):0;
   return '<span class="yzm-bar" title="'+esc(item.label)+': '+value+'" style="width:'+width+'%;background:'+item.color+'"></span>';
  }).join('');
  return '<div class="yzm-chart-row"><time>'+day.slice(5)+'</time><div class="yzm-bars">'+bars+'</div><b>'+totalDay+'</b></div>';
 }).join('');
 const statusPill=ready=>'<span class="yzm-source-status '+(ready?'ready':'unavailable')+'">'+(ready?'Disponible':'Indisponible')+'</span>';
 const card=(label,value,note,icon,ready)=>'<article class="yzm-stat"><div class="yzm-stat-top"><span class="yzm-stat-icon">'+icon+'</span>'+statusPill(ready)+'</div><label>'+label+'</label><strong class="yzm-stat-value">'+(ready?Number(value).toLocaleString('fr-FR'):'—')+'</strong><small>'+ (ready?note:'Source de données indisponible; aucune valeur affichée.')+'</small></article>';
 const source=(name,detail,ready)=>'<article class="yzm-source"><div><b>'+name+'</b><small>'+detail+'</small></div>'+statusPill(ready)+'</article>';
 const telemetryNote=metricsReady
  ?'Comptages agrégés, sans identifiant de téléphone, adresse e-mail ni historique individuel. Les installations sont comptées uniquement quand elles passent par WebADB.'
  :'Les compteurs anonymes ne sont pas disponibles. Vérifie que la migration Supabase 20261011000000_yz_mdm_metrics.sql a été exécutée.';
 const anyRecent=metricsReady&&days.some(day=>series.some(item=>dailyValue(day,item.key)>0));
 const chartContent=metricsReady
  ?(anyRecent?'<div class="yzm-legend">'+series.map(item=>'<span><i style="background:'+item.color+'"></i>'+item.label+'</span>').join('')+'</div><div class="yzm-chart">'+chartRows+'</div>':'<div class="yzm-empty">Aucun événement mesuré sur les 14 derniers jours. Les relevés vérifiés sont affichés à zéro dans le tableau ci-dessous.</div>')
  :'<div class="yzm-empty">Graphique indisponible tant que les compteurs Supabase ne répondent pas.</div>';
 const dailyTable=metricsReady?'<details class="yzm-details"><summary>Afficher les relevés par jour</summary><div class="table-wrap"><table class="table"><thead><tr><th>Date UTC</th><th>Visites</th><th>Connexions WebADB</th><th>Installations</th><th>Échecs</th></tr></thead><tbody>'+days.slice().reverse().map(day=>'<tr><td>'+day+'</td><td>'+dailyValue(day,'site_visit')+'</td><td>'+dailyValue(day,'webadb_connected')+'</td><td>'+dailyValue(day,'launcher_installed')+'</td><td>'+dailyValue(day,'install_failed')+'</td></tr>').join('')+'</tbody></table></div></details>':'';
 host.innerHTML='<div class="yzm-dashboard">'+
  '<section class="panel yzm-hero"><div><div class="yzm-eyebrow">TABLEAU DE SUIVI · YZ MDM</div><h2>Activité et qualité des données</h2><p>Fenêtre de suivi : 30 derniers jours. Les chiffres apparaissent uniquement quand leur source répond.</p><small>Dernière actualisation : '+new Date().toLocaleString('fr-FR')+'</small></div><button class="button" id="yzStatsRefresh">Actualiser les données</button></section>'+
  '<div class="yzm-grid">'+
   card('Visites du site',metricsReady?total('site_visit'):'—','Événements anonymes agrégés · 30 jours','↗',metricsReady)+
   card('Connexions WebADB',metricsReady?total('webadb_connected'):'—','Connexions réussies comptées · 30 jours','⌁',metricsReady)+
   card('Installations YZ',metricsReady?total('launcher_installed'):'—','Installations remontées via WebADB · 30 jours','↓',metricsReady)+
   card('Échecs d’installation',metricsReady?total('install_failed'):'—','Événements remontés · 30 jours','!',metricsReady)+
   card('Clics sur le téléchargement APK',metricsReady?total('download_click'):'—','Clics comptés, pas téléchargements terminés','⇩',metricsReady)+
   card('Téléchargements des Releases',releasesReady?downloads:'—','Total cumulatif déclaré par GitHub','⬇',releasesReady)+
   card('Builds en erreur',runsReady?failedRuns:'—','Parmi les 30 derniers workflows GitHub','⚒',runsReady)+
   card('Issues ouvertes',issuesReady?issues.length:'—','Issues GitHub, pull requests exclues','◇',issuesReady)+
   card('Candidatures en attente',pending,'Comptage direct de YiDream Suite','◎',true)+
  '</div>'+
  '<div class="yzm-lower-grid"><section class="panel yzm-panel"><div class="yzm-section-head"><div><h2>Évolution journalière</h2><p>Visites, connexions WebADB et installations · 14 derniers jours</p></div><span class="yzm-period">UTC</span></div>'+chartContent+dailyTable+'</section>'+
   '<section class="panel yzm-panel"><div class="yzm-section-head"><div><h2>Sources des données</h2><p>État réel des connexions au moment du rafraîchissement</p></div></div><div class="yzm-source-list">'+
    source('Télémétrie YZ MDM','Agrégats anonymes Supabase',metricsReady)+
    source('Téléchargements','Releases publiques GitHub',releasesReady)+
    source('Automatisations','30 derniers workflows GitHub',runsReady)+
    source('Support communautaire','Issues GitHub ouvertes',issuesReady)+
    source('Gestion YiDream','Candidatures administrateur',true)+
   '</div><div class="notice yzm-note">'+telemetryNote+'</div><div class="yzm-note yzm-caveat">Les applications installées hors WebADB ne sont pas comptabilisées comme installations YZ. Les téléchargements des Releases sont cumulés depuis GitHub et ne représentent pas une période de 30 jours.</div></section></div>'+
  '</div>';
 host.querySelector('#yzStatsRefresh').onclick=()=>loadYzMdmDashboard(host,ownerData);
}
function applicationRows(items){return items.length?items.map(x=>`<div class="activity-row"><b>${esc(x.store_name)}</b><small>${esc(x.email||x.user_id)} · ${new Date(x.created_at).toLocaleDateString('fr-FR')}</small></div>`).join(''):'<div class="empty">Aucune candidature en attente.</div>'}
async function reloadOwner(){state.ownerData=await withTimeout(cloud.loadOwnerData(),'des données de gestion');renderOwnerPortal()}
function head(title,sub,action=''){return `<div class="heading"><div><h1>${title}</h1><p>${sub}</p></div>${action}</div>`}
function render(){
 if(!state.data)return;
 if(state.page!=='android')disposeAndroidWizard();
 shell();const c=$('#content'),d=state.data;
 const mdmView=mdmViewForPage(state.page);if(mdmView&&mdmView!=='home'){c.innerHTML=(mdmView==='home'?welcomeMarkup():'')+mdmFrameMarkup(mdmView);return}
 if(state.page==='android'){c.innerHTML='<div id="androidHost"></div>';mountAndroidWorkspace($('#androidHost'));return}
 if(state.page==='dashboard'){
  c.innerHTML=welcomeMarkup()+mdmFrameMarkup('home')+`<section class="panel suite-recent"><div class="panel-head"><h2>Appareils récents</h2><button class="link" data-goto="devices">Tout voir →</button></div>${d.devices.length?d.devices.slice(0,5).map(deviceRow).join(''):'<div class="empty">Aucun appareil inscrit pour le moment.</div>'}</section>`;
  c.querySelector('[data-open-android]').onclick=()=>openAndroidConfigurator();
  c.querySelector('[data-goto="devices"]').onclick=()=>{clearMdmHash();state.page='devices';state.tab='Tous';state.platformLabel='';render()};
 }else if(state.page==='devices')renderDevices(c,d);
 else if(state.page==='clients')renderClients(c,d);
 else renderActivity(c,d);
}
function deviceRow(x){
 const cl=state.data.clients.find(c=>c.id===x.client_id);
 const icon={Android:'🤖',iOS:'▯',macOS:'▱',Windows:'▦'}[x.platform]||'▣';
 return `<div class="device-row"><div class="device-name"><span class="device-icon">${icon}</span><span><b>${esc(x.name)}</b><small>${esc(x.platform)} · ${cl?esc(cl.name):'Sans client'} · ${x.configuration_status==='configured'?'Configuré':'À configurer'}</small></span></div><span class="cell">${cl?esc(cl.name):'Sans client'}</span><span class="badge">${esc(x.platform)}</span><span class="cell">${new Date(x.created_at).toLocaleDateString('fr-FR')}</span></div>`;
}
function deviceStatusText(device){return device.configuration_status==='configured'?'Configuré par le propriétaire':device.configuration_status==='needs_configuration'?'En attente de préparation':'État de préparation non renseigné'}
function ownerDeviceList(data) {
 const selected = data.devices.find(device => device.id === state.selectedDeviceId);
 const rows = data.devices.map(device => {
  const store = data.stores.find(store => store.user_id === device.user_id);
  const ready = device.configuration_status === 'configured';
  return `<tr data-device-search="${esc(device.name + ' ' + device.id)}"><td><button type="button" class="link" data-device-detail="${esc(device.id)}">${esc(device.name)}</button></td>
    <td>${esc(device.platform)}</td><td>${esc(store?.shop_name || device.user_id)}</td>
    <td>${esc(deviceStatusText(device))}</td>
    <td>${ready ? `<button class="link" data-device-ready="${esc(device.id)}" data-ready="false">${deviceCopy(adminLanguage, 'revokeApproval')}</button>` : ''}</td></tr>`;
 }).join('');
 return `<section class="panel">
  <div class="panel-head"><h2>Appareils et préparation</h2>
    <button class="link" data-open-android>Configurer un téléphone</button></div>
  ${deviceSearchInput()}
  <div id="deviceDetail">${selected ? renderDeviceDetails(selected, data) : ''}</div>
  <div class="table-wrap"><table class="table">
   <thead><tr><th>Appareil</th><th>Plateforme</th><th>Magasin</th><th>Préparation</th><th></th></tr></thead>
   <tbody>${rows || '<tr><td colspan="5">Aucun appareil enregistré.</td></tr>'}</tbody>
  </table></div></section>`;
}

function deviceSearchInput() {
 const label = deviceCopy(adminLanguage, 'findDevice');
 return `<input class="search device-search" type="search" id="search" aria-label="${esc(label)}"
  placeholder="${esc(label)}" value="${esc(state.deviceQuery)}">`;
}

function bindDeviceSearch() {
 const input = $('#search');
 if (!input) return;
 const update = () => {
  state.deviceQuery = input.value;
  const query = input.value.trim().toLowerCase();
  document.querySelectorAll('[data-device-search]').forEach(row => {
   row.hidden = !row.dataset.deviceSearch.toLowerCase().includes(query);
  });
 };
 input.addEventListener('input', update);
 update();
}

function renderDeviceDetails(device) {
 const isAndroid = device.platform === 'Android';
 const copy = key => deviceCopy(adminLanguage, key);
 const canApprove = isAndroid && state.platformRole === 'owner' && device.configuration_status !== 'configured';
 return `<section class="panel device-detail-card">
  <div class="device-detail-head">
   <div><small>FICHE APPAREIL</small><h2>${esc(device.name)}</h2><p>${esc(device.platform)} · ${esc(deviceStatusText(device))}</p></div>
   <button type="button" class="link" data-close-device-detail>Fermer</button>
  </div>
  <div class="device-record-id"><small>${copy('deviceId')}</small>
   <div class="setup-id"><code dir="ltr">${esc(device.id)}</code>
    <button type="button" class="button" data-copy-device-id>${copy('copy')}</button></div>
  </div>
  ${device.note ? `<div class="device-note"><small>NOTE INTERNE</small><p>${esc(device.note)}</p></div>` : ''}
  <div data-device-controls></div>
  ${canApprove ? `<p class="small">${copy('approvalHint')}</p>
    <button type="button" class="button primary" data-approve-record>${copy('approval')}</button>` : ''}
  <div class="device-detail-footer">
   <div>${isAndroid ? `<button type="button" class="button" data-configure-device="${esc(device.id)}">Ouvrir la configuration Android</button>` : ''}
   <button type="button" class="button" data-remove-detail="${esc(device.id)}">Retirer la fiche</button></div>
  </div>
 </section>`;
}

function bindDeviceDetails(data, rerender, reload) {
 const detail = $('#deviceDetail');
 const device = data.devices.find(device => device.id === state.selectedDeviceId);
 if (!detail || !device) return;
 const copy = key => deviceCopy(adminLanguage, key);
 mountDeviceControls(detail.querySelector('[data-device-controls]'), {
  device, clients: data.clients, language: adminLanguage, packages: knownAppPackages, api: cloud,
  onAssignment(clientId) {
   const cell = Array.from(document.querySelectorAll('[data-device-client]'))
    .find(element => element.dataset.deviceClient === device.id);
   if (cell) cell.textContent = data.clients.find(client => client.id === clientId)?.name || '—';
  }
 });
 detail.querySelector('[data-copy-device-id]').onclick = async event => {
  const button = event.currentTarget;
  try {
   await navigator.clipboard.writeText(device.id);
   button.textContent = copy('copied');
  } catch {
   const range = document.createRange();
   range.selectNodeContents(button.previousElementSibling);
   const selection = window.getSelection();
   selection.removeAllRanges();
   selection.addRange(range);
  }
 };
 detail.querySelector('[data-close-device-detail]').onclick = () => {
  state.selectedDeviceId = null;
  rerender();
 };
 const approve = detail.querySelector('[data-approve-record]');
 if (approve) approve.onclick = async () => {
  approve.disabled = true;
  try {
   await cloud.setDeviceConfigured(device.id, true);
   await reload();
  } catch (error) { notify(errorText(error)); }
  finally { approve.disabled = false; }
 };
 const setup = detail.querySelector('[data-configure-device]');
 if (setup) setup.onclick = () => openAndroidConfigurator(device.id);
 detail.querySelector('[data-remove-detail]').onclick = async () => {
  if (!confirm('Retirer cette fiche ?')) return;
  try {
   await cloud.removeDevice(device.id);
   state.selectedDeviceId = null;
   await reload();
  } catch (error) { notify(errorText(error)); }
 };
}
function renderDevices(c,d){
 const rows=d.devices.filter(x=>state.tab==='Tous'||x.platform===state.tab);
 const selected=d.devices.find(x=>x.id===state.selectedDeviceId);
 c.innerHTML=head(state.platformLabel||'Appareils','Appareils inscrits dans votre espace revendeur.', '<button class="button primary" id="add">＋ Ajouter un appareil</button>')+`<div class="panel"><div class="tabs">${['Tous','Android','iOS','macOS','Windows','Other'].map(x=>`<button data-tab="${x}" class="${state.tab===x?'active':''}">${x} ${x==='Tous'?d.devices.length:d.devices.filter(z=>z.platform===x).length}</button>`).join('')}</div><div class="actions" style="margin-bottom:14px">${deviceSearchInput()}</div><div id="form"></div><div id="deviceDetail">${selected?renderDeviceDetails(selected,d):''}</div><div class="table-wrap">${rows.length?`<table class="table"><thead><tr><th>Appareil</th><th>Plateforme</th><th>Client</th><th>Préparation</th><th>Ajouté</th><th></th></tr></thead><tbody>${rows.map(x=>{const cl=d.clients.find(y=>y.id===x.client_id);return `<tr data-device-search="${esc(x.name + ' ' + x.id)}"><td><button type="button" class="link" data-device-detail="${x.id}">${esc(x.name)}</button></td><td>${esc(x.platform)}</td><td data-device-client="${esc(x.id)}">${cl?esc(cl.name):'—'}</td><td>${esc(deviceStatusText(x))}</td><td>${new Date(x.created_at).toLocaleDateString('fr-FR')}</td><td><button class="link" data-remove="${x.id}">Retirer</button></td></tr>`}).join('')}</tbody></table>`:'<div class="empty">Aucun appareil correspondant.</div>'}</div><div class="notice">L’état de préparation est validé par le propriétaire YiDream. La présence et la connexion USB ne sont pas détectées depuis cette liste.</div></div>`;
 bindDeviceSearch();
 document.querySelectorAll('[data-tab]').forEach(b=>b.onclick=()=>{state.tab=b.dataset.tab;state.platformLabel=state.tab==='Tous'?'':state.tab;render()});
 $('#add').onclick=()=>deviceForm(d);
 document.querySelectorAll('[data-device-detail]').forEach(b=>b.onclick=()=>{state.selectedDeviceId=b.dataset.deviceDetail;renderDevices($('#content'),state.data)});
 bindDeviceDetails(d, () => renderDevices($('#content'), state.data), refresh);
 document.querySelectorAll('[data-remove]').forEach(b=>b.onclick=async()=>{const id=b.dataset.remove;if(confirm('Retirer cette fiche ?'))try{await cloud.removeDevice(id);state.selectedDeviceId=null;await refresh()}catch(e){notify(errorText(e))}});
}
function deviceForm(d){const el=$('#form');el.innerHTML=`<div class="panel"><div class="form"><div class="field"><label>Nom de l’appareil</label><input id="deviceName" placeholder="Ex. Galaxy A15"></div><div class="field"><label>Plateforme</label><select id="platform"><option>Android</option><option>iOS</option><option>macOS</option><option>Windows</option><option>Other</option></select></div><div class="field"><label>Client (facultatif)</label><select id="client"><option value="">—</option>${d.clients.map(x=>`<option value="${x.id}">${esc(x.name)}</option>`).join('')}</select></div><div class="field"><label>Note</label><input id="note" placeholder="Note interne"></div></div><div class="notice">Après l’inscription, l’appareil restera en attente jusqu’à sa configuration physique et à sa validation par le propriétaire YiDream.</div><div class="actions" style="margin-top:14px"><button id="save" class="button primary">Enregistrer</button><button id="cancel" class="button">Annuler</button></div></div>`;
 $('#cancel').onclick=()=>el.innerHTML='';$('#save').onclick=async()=>{try{const name=$('#deviceName').value.trim();if(!name)throw Error('Saisissez un nom pour l’appareil.');await cloud.addDevice({name,platform:$('#platform').value,clientId:$('#client').value,note:$('#note').value});await refresh()}catch(e){notify(errorText(e))}}
}
function renderClients(c,d){
 const rows=d.clients.filter(x=>!state.clientQuery||`${x.name} ${x.group_name}`.toLowerCase().includes(state.clientQuery));
 c.innerHTML=head('Clients','Gérez les clients et associez-leur les appareils.', '<button class="button primary" id="add">＋ Nouveau client</button>')+`<section class="panel"><div class="actions" style="margin-bottom:14px"><input id="search" class="search" placeholder="Rechercher un client…" value="${esc(state.clientQuery)}"></div><div id="form"></div><div class="table-wrap">${rows.length?`<table class="table"><thead><tr><th>Client</th><th>Groupe</th><th>Appareils associés</th><th>Créé</th><th></th></tr></thead><tbody>${rows.map(x=>`<tr><td>${esc(x.name)}</td><td>${esc(x.group_name)||'—'}</td><td>${d.devices.filter(z=>z.client_id===x.id).length}</td><td>${new Date(x.created_at).toLocaleDateString('fr-FR')}</td><td><button class="link" data-remove="${x.id}">Retirer</button></td></tr>`).join('')}</tbody></table>`:'<div class="empty">Aucun client pour le moment.</div>'}</div></section>`;
 $('#search').oninput=e=>{state.clientQuery=e.target.value;renderClients($('#content'),state.data)};
 $('#add').onclick=()=>{const el=$('#form');el.innerHTML=`<div class="panel"><div class="form"><div class="field"><label>Nom du client</label><input id="clientName"></div><div class="field"><label>Groupe (facultatif)</label><input id="groupName"></div></div><div class="actions" style="margin-top:14px"><button id="save" class="button primary">Enregistrer</button><button id="cancel" class="button">Annuler</button></div></div>`;$('#cancel').onclick=()=>el.innerHTML='';$('#save').onclick=async()=>{try{const name=$('#clientName').value.trim();if(!name)throw Error('Saisissez le nom du client.');await cloud.addClient({name,group:$('#groupName').value});await refresh()}catch(e){notify(errorText(e))}}};
 document.querySelectorAll('[data-remove]').forEach(b=>b.onclick=async()=>{if(confirm('Retirer ce client ?'))try{await cloud.removeClient(b.dataset.remove);await refresh()}catch(e){notify(errorText(e))}});
}
function renderActivity(c,d){c.innerHTML=head('Journal d’activité','Actions enregistrées dans votre espace.')+`<section class="panel table-wrap">${d.logs.length?`<table class="table"><thead><tr><th>Action</th><th>Date</th></tr></thead><tbody>${d.logs.map(x=>`<tr><td>${esc(x.action)}</td><td>${new Date(x.created_at).toLocaleString('fr-FR')}</td></tr>`).join('')}</tbody></table>`:'<div class="empty">Aucune activité pour le moment.</div>'}</section>`}
function suspendedScreen(){
 app.innerHTML='<div class="auth-wrap"><section class="auth"><div class="brand"><img src="'+logoUrl+'" alt=""> YiDream <span style="color:#73819a;font-weight:500">Suite</span></div><h1>Accès administrateur suspendu</h1><p>Le propriétaire YiDream a suspendu ce compte. Les données et appareils restent conservés, mais les actions administrateur sont bloquées. Contacte le propriétaire pour demander le rétablissement de l’accès.</p><button class="button primary" id="suspendedLogout">Se déconnecter</button></section></div>';
 const button=$('#suspendedLogout');if(button)button.onclick=async()=>{await cloud.signOut();state.session=null;authScreen('login')};
}
let accessWatchStarted=false;
function watchAdminAccess(){
 if(accessWatchStarted)return;accessWatchStarted=true;
 window.setInterval(async()=>{if(!state.session||state.platformRole!=='admin')return;try{const role=await cloud.platformRole();if(role!=='admin'){state.platformRole='suspended';await disconnectAndroidWorkspace().catch(()=>{});try{await cloud.signOut()}catch{}state.session=null;state.data=null;suspendedScreen()}}catch(error){console.warn('Vérification des droits administrateur indisponible',error)}},30000);
}
async function start(){
 try{
  await withTimeout(cloud.ready,'le chargement du service de connexion');
  if(!cloud.configured){app.innerHTML='<div class="auth-wrap"><section class="auth"><h1>Connexion à configurer</h1><p>YiDream Suite attend la configuration Supabase.</p><div class="notice">Vérifiez les paramètres de connexion du projet.</div></section></div>';return}
  state.session=await withTimeout(cloud.session(),'la session revendeur');
  if(!state.session){
    const callbackError=oauthErrorFromUrl();
    if(callbackError){history.replaceState({},document.title,location.pathname+location.hash);authScreen('login',callbackError);return}
    const params=new URLSearchParams(location.search);
    if(params.has('apply'))authScreen('register');
    else if(params.has('login'))authScreen('login');
    else publicPortal();
    return;
  }
  state.platformRole=await withTimeout(cloud.platformRole(),'les droits du compte');
  if(state.platformRole==='suspended'){suspendedScreen();return}
  if(state.platformRole==='owner'){
    state.ownerData=await withTimeout(cloud.loadOwnerData(),'les données de gestion');
    renderOwnerPortal();
    return;
  }
  if(state.platformRole!=='admin'){
    const application=await withTimeout(cloud.myAdminApplication(),'votre candidature');
    if(application){pendingScreen(application);return}
    onboarding();return;
  }
  let p=await withTimeout(cloud.ensureProfile(),'le profil revendeur');
  if(!p){onboarding();return;}
  await refresh();
  watchAdminAccess();
 }catch(e){app.innerHTML='<div class="auth-wrap"><section class="auth"><h1>Impossible de charger votre espace</h1><p>'+esc(errorText(e))+'</p><button class="button" onclick="location.reload()">Réessayer</button></section></div>'}
}
start();
