/**
 * The words of the feedback form, in the clinic's three languages. [1.112.0]
 *
 * The QUESTIONS come from the server (Admin writes them); everything else a patient reads on the
 * form is here. The three answers are the paper form's own — MAAYO / OKAY LANG / DILI MAAYO —
 * and are fixed, so one month's answers can be compared with the next.
 *
 * The Tagalog and English are drafts for the clinic to confirm.
 */

export const LANGUAGES = [
  { code: 'ceb', label: 'Cebuano' },
  { code: 'tl', label: 'Tagalog' },
  { code: 'en', label: 'English' },
];

/** 3 / 2 / 1, as stored. `tone` is for the overview's bars; the label always says it in words. */
export const RATINGS = [
  { value: 3, key: 'good', tone: 'good', label: { ceb: 'Maayo', tl: 'Mabuti', en: 'Good' } },
  { value: 2, key: 'ok', tone: 'ok', label: { ceb: 'Okay lang', tl: 'Okay lang', en: 'Okay' } },
  { value: 1, key: 'poor', tone: 'poor', label: { ceb: 'Dili maayo', tl: 'Hindi mabuti', en: 'Poor' } },
];

const WORDS = {
  title: { ceb: 'Unsa ang imong kasinatian?', tl: 'Kumusta ang iyong pagbisita?', en: 'How was your visit?' },
  intro: {
    ceb: 'Pilia ang imong tubag sa matag pangutana. Mahimo nimong laktawan ang usa ka pangutana.',
    tl: 'Piliin ang iyong sagot sa bawat tanong. Maaari mong laktawan ang isang tanong.',
    en: 'Choose an answer for each question. You can skip any of them.',
  },
  comment: {
    ceb: 'Komento / Suggestion',
    tl: 'Komento / Mungkahi',
    en: 'Comments / Suggestions',
  },
  hideName: {
    ceb: 'Ayaw ipakita ang akong pangalan uban sa akong mga tubag',
    tl: 'Huwag ipakita ang aking pangalan kasama ng aking mga sagot',
    en: "Don't show my name with my answers",
  },
  submit: { ceb: 'Ipadala', tl: 'Ipadala', en: 'Send' },
  later: { ceb: 'Sunod na lang', tl: 'Mamaya na lang', en: 'Not now' },
  thanks: { ceb: 'Salamat sa imong feedback!', tl: 'Salamat sa iyong feedback!', en: 'Thank you for your feedback!' },
};

/** A word of the form in a language, falling back to Cebuano — the paper form's own. */
export const word = (key, lang) => WORDS[key]?.[lang] || WORDS[key]?.ceb || '';

/** A question's wording in a language, falling back to Cebuano. */
export const promptFor = (question, lang) =>
  question?.[`prompt_${lang}`] || question?.prompt_ceb || '';

export const ratingLabel = (value, lang = 'en') =>
  RATINGS.find((r) => r.value === Number(value))?.label[lang] || '';

/** A blank form, in the paper form's language. */
export const EMPTY_FEEDBACK = { language: 'ceb', answers: {}, comment: '', nameHidden: false };

/** The body the API takes. */
export const feedbackBody = (value) => ({
  answers: value.answers,
  comment: value.comment,
  language: value.language,
  nameHidden: value.nameHidden,
});
