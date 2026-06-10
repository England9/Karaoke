import { getSongDuration, songDatabase } from './songDatabase';

export const mockSong = songDatabase[0];

export const mockSongDuration = getSongDuration(mockSong);
