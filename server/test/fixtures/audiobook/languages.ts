/**
 * One small book per supported language, as plain text with headings, front
 * matter and back matter. Every passage is the opening of a public-domain
 * work (authors who died more than 70 years ago):
 *
 *   de  Franz Kafka, Die Verwandlung (1915)
 *   fr  Gustave Flaubert, Madame Bovary (1857)
 *   es  Miguel de Cervantes, Don Quijote (1605)
 *   it  Alessandro Manzoni, I promessi sposi (1827)
 *   pt  Machado de Assis, Dom Casmurro (1899)
 *   nl  Multatuli, Max Havelaar (1860)
 *   pl  Henryk Sienkiewicz, Quo vadis (1896)
 *   ru  Lev Tolstoy, Anna Karenina (1878)
 *   zh  Lu Xun, 狂人日记 (1918)
 *   ja  Natsume Sōseki, 吾輩は猫である (1905)
 */

export interface LanguageFixture {
  lang: string;
  text: string;
  /** Section titles the parser should find, in order. */
  titles: string[];
  /** Expected [kind, included] per section. */
  kinds: [string, boolean][];
}

const twice = (s: string) => `${s} ${s}`;

export const LANGUAGE_FIXTURES: LanguageFixture[] = [
  {
    lang: "de",
    text: `Inhalt\n\nErstes Kapitel\nZweites Kapitel\nNachwort\nAnmerkungen\n\nVorwort\n\nDiese Ausgabe folgt dem Text der ersten Ausgabe.\n\nErstes Kapitel\n\n${twice("Als Gregor Samsa eines Morgens aus unruhigen Träumen erwachte, fand er sich in seinem Bett zu einem ungeheueren Ungeziefer verwandelt. Er lag auf seinem panzerartig harten Rücken und sah, wenn er den Kopf ein wenig hob, seinen gewölbten, braunen, von bogenförmigen Versteifungen geteilten Bauch.")}\n\nKapitel 2\n\n${twice("Was ist mit mir geschehen? dachte er. Es war kein Traum. Sein Zimmer, ein richtiges, nur etwas zu kleines Menschenzimmer, lag ruhig zwischen den vier wohlbekannten Wänden.")}\n\nNachwort\n\nDie Erzählung erschien zuerst im Jahr 1915.\n\nAnmerkungen\n\nZu Seite 3: Der Text folgt der Erstausgabe.`,
    titles: ["Inhalt", "Vorwort", "Erstes Kapitel", "Kapitel 2", "Nachwort", "Anmerkungen"],
    kinds: [["front_matter", false], ["front_matter", true], ["chapter", true], ["chapter", true], ["back_matter", true], ["back_matter", false]],
  },
  {
    lang: "fr",
    text: `Préface\n\nCette édition reprend le texte de 1857.\n\nCHAPITRE PREMIER\n\n${twice("Nous étions à l'Étude, quand le Proviseur entra, suivi d'un nouveau habillé en bourgeois et d'un garçon de classe qui portait un grand pupitre. Ceux qui dormaient se réveillèrent, et chacun se leva comme surpris dans son travail.")}\n\nChapitre II\n\n${twice("Le Proviseur nous fit signe de nous rasseoir ; puis, se tournant vers le maître d'études, il lui dit à demi-voix qu'il était recommandé.")}\n\nRemerciements\n\nMerci à tous les lecteurs de cette édition.\n\nTable des matières\n\nChapitre premier\nChapitre II\nRemerciements\nPréface`,
    titles: ["Préface", "Chapitre Premier", "Chapitre II", "Remerciements", "Table des matières"],
    kinds: [["front_matter", true], ["chapter", true], ["chapter", true], ["back_matter", true], ["front_matter", false]],
  },
  {
    lang: "es",
    text: `Dedicatoria\n\nPara mis lectores.\n\nPrólogo\n\n${twice("Desocupado lector: sin juramento me podrás creer que quisiera que este libro, como hijo del entendimiento, fuera el más hermoso, el más gallardo y más discreto que pudiera imaginarse.")}\n\nCapítulo primero\n\n${twice("En un lugar de la Mancha, de cuyo nombre no quiero acordarme, no ha mucho tiempo que vivía un hidalgo de los de lanza en astillero, adarga antigua, rocín flaco y galgo corredor.")}\n\nCapítulo II\n\n${twice("Hechas, pues, estas prevenciones, no quiso aguardar más tiempo a poner en efeto su pensamiento, y así, sin dar parte a persona alguna de su intención, una mañana salió al campo.")}\n\nÍndice\n\nPrólogo 1\nCapítulo primero 5\nCapítulo II 12\nEpílogo 30`,
    titles: ["Dedicatoria", "Prólogo", "Capítulo primero", "Capítulo II", "Índice"],
    kinds: [["front_matter", true], ["chapter", true], ["chapter", true], ["chapter", true], ["front_matter", false]],
  },
  {
    lang: "it",
    text: `Introduzione\n\nIl testo segue l'edizione del 1840.\n\nCapitolo I\n\n${twice("Quel ramo del lago di Como, che volge a mezzogiorno, tra due catene non interrotte di monti, tutto a seni e a golfi, a seconda dello sporgere e del rientrare di quelli, vien, quasi a un tratto, a ristringersi, e a prender corso e figura di fiume.")}\n\nCapitolo secondo\n\n${twice("Si racconta che il principe di Condé dormì profondamente la notte avanti la giornata di Rocroi: ma, in primo luogo, era molto affaticato; secondariamente aveva già date tutte le disposizioni necessarie.")}\n\nRingraziamenti\n\nGrazie a chi ha letto questo libro con pazienza.`,
    titles: ["Introduzione", "Capitolo I", "Capitolo secondo", "Ringraziamenti"],
    kinds: [["front_matter", true], ["chapter", true], ["chapter", true], ["back_matter", true]],
  },
  {
    lang: "pt",
    text: `Todos os direitos reservados. Esta edição é de domínio público.\n\nCapítulo Primeiro\n\n${twice("Uma noite destas, vindo da cidade para o Engenho Novo, encontrei no trem da Central um rapaz aqui do bairro, que eu conheço de vista e de chapéu. Cumprimentou-me, sentou-se ao pé de mim, falou da lua e dos ministros, e acabou recitando-me versos.")}\n\nCapítulo II\n\n${twice("Agora que expliquei o título, passo a escrever o livro. Antes disso, porém, digamos os motivos que me põem a pena na mão.")}\n\nSobre o autor\n\nJoaquim Maria Machado de Assis nasceu no Rio de Janeiro em 1839.`,
    titles: ["Opening", "Capítulo Primeiro", "Capítulo II", "Sobre o autor"],
    kinds: [["front_matter", false], ["chapter", true], ["chapter", true], ["back_matter", true]],
  },
  {
    lang: "nl",
    text: `Voorwoord\n\nDeze uitgave volgt de tekst van 1860.\n\nHoofdstuk 1\n\n${twice("Ik ben makelaar in koffie, en woon op de Lauriergracht, No. 37. Het is mijn gewoonte niet, romans te schrijven, of zulke dingen, en het heeft dan ook lang geduurd, voor ik er toe overging een paar riem papier extra te bestellen en het werk aan te vangen, dat gij, lieve lezer, zoo-even in de hand hebt genomen.")}\n\nHoofdstuk twee\n\n${twice("Ik heb dan ook nooit verzen gemaakt, en het is mij een raadsel hoe iemand de moed heeft om dat te doen en het dan nog aan anderen te laten lezen.")}\n\nNawoord\n\nDe schrijver gebruikte de naam Multatuli voor dit boek.`,
    titles: ["Voorwoord", "Hoofdstuk 1", "Hoofdstuk twee", "Nawoord"],
    kinds: [["front_matter", true], ["chapter", true], ["chapter", true], ["back_matter", true]],
  },
  {
    lang: "pl",
    text: `Wstęp\n\nTo wydanie jest w domenie publicznej.\n\nRozdział pierwszy\n\n${twice("Petroniusz obudził się zaledwie koło południa i jak zwykle zmęczony bardzo. Poprzedniego dnia był na uczcie u Nerona, która przeciągnęła się do późna w noc. Od pewnego czasu zdrowie jego poczęło się psuć. Sam mówił, że budzi się jakby zdrętwiały i bez możności zebrania myśli.")}\n\nRozdział II\n\n${twice("Winicjusz wyszedł z domu Aulusów i był już na ulicy, ale nie mógł zapomnieć o tym, co widział, i ciągle o tym myślał, gdy szedł do domu.")}\n\nPrzypisy\n\n1. Tekst według pierwszego wydania.`,
    titles: ["Wstęp", "Rozdział pierwszy", "Rozdział II", "Przypisy"],
    kinds: [["front_matter", true], ["chapter", true], ["chapter", true], ["back_matter", false]],
  },
  {
    lang: "ru",
    text: `Предисловие\n\nТекст печатается по первому изданию.\n\nЧАСТЬ ПЕРВАЯ\n\n${twice("Все счастливые семьи похожи друг на друга, каждая несчастливая семья несчастлива по-своему. Все смешалось в доме Облонских. Жена узнала, что муж был в связи с бывшею в их доме француженкою-гувернанткой, и объявила мужу, что не может жить с ним в одном доме.")}\n\nГлава 2\n\n${twice("Степан Аркадьич был человек правдивый в отношении к себе самому. Он не мог обманывать себя и уверять себя, что он раскаивается в своем поступке.")}\n\nОб авторе\n\nЛев Николаевич Толстой родился в 1828 году.`,
    titles: ["Предисловие", "Часть Первая", "Глава 2", "Об авторе"],
    kinds: [["front_matter", true], ["chapter", true], ["chapter", true], ["back_matter", true]],
  },
  {
    lang: "zh",
    text: `序\n\n本书据初版排印。\n\n第一章\n\n${twice("今天晚上，很好的月光。我不见他，已是三十多年；今天见了，精神分外爽快。才知道以前的三十多年，全是发昏；然而须十分小心。不然，那赵家的狗，何以看我两眼呢？我怕得有理。")}\n\n第二章 夜\n\n${twice("今天全没月光，我知道不妙。早上小心出门，赵贵翁的眼色便怪：似乎怕我，似乎想害我。还有七八个人，交头接耳的议论我，又怕我看见。")}\n\n后记\n\n这篇小说最初发表于一九一八年。`,
    titles: ["序", "第一章", "第二章 夜", "后记"],
    kinds: [["front_matter", true], ["chapter", true], ["chapter", true], ["back_matter", true]],
  },
  {
    lang: "ja",
    text: `まえがき\n\nこの本は初版の本文に従う。\n\n第一章\n\n${twice("吾輩は猫である。名前はまだ無い。どこで生れたかとんと見当がつかぬ。何でも薄暗いじめじめした所でニャーニャー泣いていた事だけは記憶している。吾輩はここで始めて人間というものを見た。")}\n\n第二章\n\n${twice("吾輩は新年来多少有名になったので、猫ながらちょっと鼻が高く感ぜらるるのはありがたい。")}\n\nあとがき\n\nこの作品は一九〇五年に発表された。`,
    titles: ["まえがき", "第一章", "第二章", "あとがき"],
    kinds: [["front_matter", true], ["chapter", true], ["chapter", true], ["back_matter", true]],
  },
];
