import { LanguageDescription } from '@codemirror/language';
import { languages } from '@codemirror/language-data';

const namedFiles = [
  [/^artisan$/i,'PHP'],
  [/^(?:Dockerfile|Containerfile)(?:\..+)?$/i,'Dockerfile'],
  [/^(?:\.env(?:\..+)?|\.editorconfig|\.gitconfig|\.npmrc|\.yarnrc)$/i,'Properties files'],
  [/^(?:composer\.lock|Pipfile\.lock|flake\.lock)$/i,'JSON'],
  [/^Pipfile$/i,'TOML'],
  [/^(?:\.bashrc|\.bash_profile|\.zshrc|\.zprofile)$|\.zsh$/i,'Shell']
];

export async function sourceLanguage(file) {
  const filename = file.split(/[\\/]/).at(-1);
  const special = namedFiles.find(([pattern]) => pattern.test(filename));
  const description = special ? LanguageDescription.matchLanguageName(languages,special[1],false)
    : LanguageDescription.matchFilename(languages,filename) || LanguageDescription.matchFilename(languages,filename.toLowerCase());
  return description?.load();
}
