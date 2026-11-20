/* All the interface strings of one language (zh-TW): the base file and the 15 add-on files, merged in the order the app has always used (a later file wins).
 Loaded the first time the language is used (see loadCatalog in i18n.ts); English stays in the main file because the English text is the key. */
import base from '../locales/zh-TW.json';
import tune from '../locales/tune-zh-TW.json';
import tools from '../locales/tools-zh-TW.json';
import fix from '../locales/fix-zh-TW.json';
import gh from '../locales/gh-zh-TW.json';
import ui from '../locales/ui-zh-TW.json';
import engine from '../locales/engine-zh-TW.json';
import pick from '../locales/pick-zh-TW.json';
import df2 from '../locales/df2-zh-TW.json';
import upd from '../locales/upd-zh-TW.json';
import r3 from '../locales/r3-zh-TW.json';
import pic from '../locales/pic-zh-TW.json';
import gui from '../locales/gui-zh-TW.json';
import sav from '../locales/sav-zh-TW.json';
import net from '../locales/net-zh-TW.json';
export default {...base,...tune,...tools,...fix,...gh,...ui,...engine,...pick,...df2,...upd,...r3,...pic,...gui,...sav,...net,...dmg,...guic,...fixa,...gfn} as Record<string,string>;
import dmg from '../locales/dmg-zh-TW.json';
import guic from '../locales/guic-zh-TW.json';
import fixa from '../locales/fixa-zh-TW.json';
import gfn from '../locales/gfn-zh-TW.json';
