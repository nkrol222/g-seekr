import { describe, expect, it } from 'vitest';
import { archiveItemId, cleanTitle, parseArchiveFiles, parseDat, parseTitles } from '../server/src/import-parse.js';

describe('import parsing', () => {
  it('cleans ROM names down to the title', () => {
    expect(cleanTitle('Legend of Zelda, The - A Link to the Past (USA) (Rev 1).sfc')).toBe('The Legend of Zelda - A Link to the Past');
    expect(cleanTitle('roms/snes/Super_Metroid_(Japan,_USA)_[!].sfc.zip')).toBe('Super Metroid');
    expect(cleanTitle('Final Fantasy VII (USA) (Disc 1).chd')).toBe('Final Fantasy VII');
    expect(cleanTitle('Mega Man X')).toBe('Mega Man X');
  });

  it('keeps one entry per title from pasted lines, DATs and archive items', () => {
    expect(parseTitles('Chrono Trigger (USA)\n\n# skip\nChrono Trigger (Europe)\nEarthBound').map((t) => t.title)).toEqual(['Chrono Trigger', 'EarthBound']);
    const dat = `<datafile><header/><game name="Pok&#233;mon - Red Version (USA, Europe)"><rom/></game><game name='[BIOS] Nintendo (Japan)'/><machine name="Tetris &amp; Dr. Mario (USA)"/></datafile>`;
    expect(parseDat(dat).map((t) => t.title)).toEqual(['Pokémon - Red Version', 'Tetris & Dr. Mario']);
    expect(parseArchiveFiles([{ name: 'Gradius (USA).zip' }, { name: 'item.torrent' }, { name: 'cover.png' }, { name: 'x_files.xml', source: 'metadata' }])).toEqual([{ raw: 'Gradius (USA).zip', title: 'Gradius' }]);
  });

  it('reads an Internet Archive item id from a URL or on its own', () => {
    expect(archiveItemId('https://archive.org/details/nointro.snes/')).toBe('nointro.snes');
    expect(archiveItemId('nointro.snes')).toBe('nointro.snes');
    expect(archiveItemId('https://example.com/x y')).toBeNull();
  });
});
