import {describe,it,expect} from 'vitest';
import {defaultProfile,profileSchema} from '../contracts';

describe('optional session profile',()=>{
 it('starts with no inferred preferences, geography or health context',()=>{
  expect(profileSchema.parse(defaultProfile)).toEqual({dietaryPattern:'',allergiesIntolerances:'',healthConsiderations:'',goals:'',ageGroup:'',sexOrReferenceGroup:'',country:'',locality:''});
 });
 it('keeps user-declared categories separate and rejects legacy example fields',()=>{
  const input={...defaultProfile,dietaryPattern:'Plant-based',allergiesIntolerances:'Lactose intolerance',goals:'Compare added sugars'};
  expect(profileSchema.parse(input)).toMatchObject(input);
  expect(profileSchema.safeParse({...input,chapatis:8}).success).toBe(false);
 });
});
